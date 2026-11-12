## Classical Approach

For our classical approach, we wanted a solution that wouldn't let the drone drift into the arena walls or fly through the outer net. Instead of trusting a single planner or raw VIO, we built a full C++ ROS 2 autonomy stack with layered safety guarantees across global planning, factor-graph perception, physics-aware local control, and execution watchdogs.

<div class="pair"><div>

#### Why build a full classical stack too?

- The competition gives us the course layout and gate sequence ahead of time
- Pure VIO drifts over long corridors, and stereo depth can punch holes through thin walls
- Having a deterministic C++ fallback gives us hard safety bounds if an RL policy goes rogue

</div><div>

#### Our classical pipeline

- **Corridor-centered A\*** with geometric and heading-feasible speed optimization
- **GTSAM iSAM2** keyframe depth-ICP factor graph for drift correction and local distance grids
- **50 Hz OpenMP MPPI** rolling out 1,024 trajectories through our 6-DoF quadrotor plant + **net CBF**

</div></div>

### Global Planner

We pre-bake a 3D ground-truth signed distance map (`course_groundtruth.bin`) with all static arena features: the walls, outer nets, and the ordered checkpoint sequence (gates, the +5 pt bonus window, and the landing pad).

This prior is fed into a 2D grid **A\*** planner at flight altitude with a **corridor-centering cost heuristic** that pulls paths toward the middle of narrow passages (with adaptive clearance relaxation right at tight gate apertures). Raw grid A\* is conservative and jagged, so we run a two-stage **geometric and kinodynamic optimization pass** to build a smooth, time-indexed reference trajectory:

#### 1. Geometric Optimization

- **Gate overshoot pinning:** Instead of aiming at a gate's center (which causes local planners to cut the corner early and miss the scoring plane), we search into a band **0.18–0.30 m past each gate line** and pin that vertex so downstream smoothing can never pull the path short.
- **Line-of-sight shortcutting:** We greedily prune redundant collinear grid cells while respecting wall clearance and never shortcutting past a pinned gate vertex.
- **Chaikin corner-cutting:** We run 4 iterations of Chaikin subdivision to turn sharp polygonal turns into smooth, continuous curves while keeping gate crossings locked.
- **Uniform arc-length resampling:** Finally, we resample the curve at a uniform **2 cm spacing** so curvature and velocity profiles can be integrated cleanly.

#### 2. Kinodynamic Speed Profile

- **Curvature & yaw-rate capping:** We compute smoothed chord curvature κ(s) along the path and cap the reference speed not just by lateral acceleration (a<sub>lat</sub> ≤ 3.0 m/s²), but also by a **45°/s yaw-rate limit** (v ≤ (dψ/dt)<sub>max</sub> / κ) so the forward depth camera never lags behind the direction of travel in tight chicanes.
- **Forward–backward acceleration pass:** We run a forward and backward longitudinal acceleration pass (a ≤ 2.0 m/s²) seeded from the drone's live speed, outputting a time-parameterized trajectory (`/plan/global_path`) to a **20 Hz Path Transformer** that continuously projects the reference into the local odometry frame.

> If the local planner detects an impassable unmodeled obstacle blocking a corridor in flight, it fires a replan trigger with the obstacle's coordinates; A\* carves that region out of the map and splices a new global route on the fly from the drone's current velocity.

### Perception Stack

Raw IMU dead-reckoning is unusable after a couple of seconds. At the flight-controller level, we correct it by fusing **cuVSLAM** (30 Hz stereo VIO velocity estimates from the OAK-D S2's 640×400 monochrome pair) along with a downward **optical flow sensor** and **VL53L1X rangefinder** into **PX4's EKF2**.

Even with VIO + optical flow, odometry still accumulates yaw and scale drift over a 15 m maze route. To give the planner a locally consistent world without creating a dangerous feedback loop into PX4's control estimator, we feed PX4's odometry and the 15 Hz stereo depth stream into a **planning-only C++ GTSAM iSAM2 factor graph** (`depth_isam2.cpp`):

- **Keyframe factor graph:** A new keyframe is spawned every **0.25 m, 10°, or 0.5 s** of motion. The graph fuses PX4 relative odometry factors, gravity-referenced roll/pitch attitude priors, body-frame velocity factors (preventing yaw drift from leaking into velocity), and **projective point-to-plane depth ICP** factors against both the previous keyframe and revisit loop-closure keyframes within 1.5 m.
- **Degenerate-axis protection:** Because the floor often drops out of the camera's 50° vertical FOV at 1.4 m altitude, depth ICP cannot observe vertical motion on vertical walls alone. Our ICP solver regularizes unobserved axes and down-weights vertical information by 50× so iSAM2 automatically trusts PX4's rangefinder-backed altitude.
- **2.5× drift reduction:** On our 14.6 m course scan benchmark with injected VIO yaw/scale drift, iSAM2 cut final position and heading error by **~2.5×** with keyframe updates taking only **12–20 ms**.

iSAM2 rebuilds a smoothed **local 3D obstacle voxel grid** (`/isam2_depth_node/obstacles`) at every keyframe and hands it off to the local planner to steer around real-world wall shifts and unmodeled obstacles.

<!-- <Perception Demo Goes here> -->

### Local Planner

Following a global path through 0.5 m corridors when walls are slightly shifted from the prior map requires more than a PID carrot-follower. We implemented a custom C++ **Model Predictive Path Integral (MPPI)** controller running at **50 Hz on the CPU** (OpenMP) that optimizes velocity and yaw-rate commands simultaneously.

#### Rolling out the real plant, not a point mass

Every 20 ms control tick, MPPI warm-starts from its previous solution and samples **1,024 noisy control sequences** over an **0.8 s horizon** (16 steps × 0.05 s) in the local path-tangent frame. Instead of stepping a kinematic point mass, each rollout forward-simulates a C++ port of our **full 6-DoF quadrotor dynamics** (`quad_plant.cpp`)—modeling the **1.35 kg deadcat frame, 30 ms motor lag, aerodynamic drag, and PX4's cascaded PID velocity controller**.

To prevent the classic sampling failure where left and right rollouts around a dead-center pillar average out into a head-on collision, **35% of our rollouts receive a bimodal cross-track velocity bias**, naturally splitting the sample cloud cleanly around corridor obstacles.

> Because MPPI rolls out PX4's actual velocity loop and motor time constants, it predicts pitch and roll transients ahead of time and starts braking *before* entering a 90° corner.

#### Scoring 1,024 rollouts: 3-source clearance & 7 critics

Each rollout step is evaluated against **seven critic terms** plus arena altitude and net barriers:

1. **Path follow & velocity alignment:** Tracks the 3D position and velocity of the time-indexed local reference from the Path Transformer.
2. **3-source O(1) obstacle clearance:** Takes the minimum distance across **(a) permanently locked static course walls** (immune to stereo disparity punch-through), **(b) live ray-cleared depth voxels**, and **(c) iSAM2's local distance grid**, with an adaptive comfort radius (`0.42 m` down to `0.23 m` in tight gates).
3. **Camera orientation & FOV alignment:** Penalizes yaw deviation from the corridor tangent and penalizes horizontal motion that drifts outside the OAK-D's **72° horizontal FOV**—forcing the drone to *look where it flies* so the depth sensor never swings blind into a corner.
4. **Control slew rate & terminal goal:** Penalizes aggressive command chatter and rewards terminal progress along the corridor.

#### Safety barriers & the Control Mux

After combining the 1,024 rollouts via softmax importance weighting and a 3-tap smoothing filter, the command passes through three final safety gates:

- **Map-frame Exponential CBF:** An **Exponential Control Barrier Function (CBF)** transforms the commanded velocity into the arena map frame and smoothly clamps outward velocity whenever the drone approaches the outer perimeter net.
- **Blocked-corridor replan trigger:** If a pillar blocks the corridor centerline with no left/right clearance—or if the minimum rollout cost spikes for **6 consecutive ticks**—MPPI commands an immediate hold and triggers a global A\* replan.
- **Control Multiplexer:** Finally, commands pass through our **Control Mux**, which arbitrates between Classical MPPI and the RL Policy while running 100 Hz watchdogs on VIO covariance, stale commands, and time-to-impact (< 0.3 s) before publishing `/fmu/in/trajectory_setpoint` to PX4.

<!-- <MPPI Demo Goes here> -->

### Results

Well, we don't really have any hardware flight clips for this one. With limited flight slots and the clock ticking down, we placed all our chips on our zero-shot RL policy and didn't get to deploy the classical stack on the real drone—though it tore through our closed-loop Gazebo SITL and unmodeled-obstacle RViz benchmarks without breaking a sweat.

At least the graphs look pretty.
