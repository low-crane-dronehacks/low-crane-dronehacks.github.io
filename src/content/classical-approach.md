## Classical Approach

For our classical approach, we wanted a stack that wouldn't let the drone drift into a wall or fly straight through the outer net. Instead of trusting raw VIO and a basic waypoint follower, we put together a C++ autonomy pipeline with layered safety guarantees across global planning, factor-graph estimation, and physics-aware local control.

<div class="pair"><div>

#### Why build a classical stack too?

- Just in case the sim2real gap on our RL approach was bigger than we thought
- Performance tuning needs rapid iteration, not long training windows
- To challenge ourselves

</div><div>

#### Our pipeline

- Corridor-centered A\* with geometric and dynamic feasibility optimizations
- GTSAM iSAM2 keyframe depth-ICP factor graph for odometry drift correction and local distance grids
- 50 Hz OpenMP MPPI rolling out 1,024 trajectories through derived quadrotor dynamics

</div></div>

<figure class="figure">
  <div class="media-frame dark-frame">
    <img
      src="/media/architecture.png"
      alt="Classical approach architecture: OAK-D S2 stereo camera, flight sensors and the static course map feed cuVSLAM, PX4 EKF2, stereo depth and a planning-only iSAM2 factor graph; an A* global planner with geometric and kinodynamic optimization sends a reference trajectory to the 50 Hz MPPI local planner, which commands PX4 with velocity and yaw-rate setpoints"
      width="3840"
      height="1980"
      loading="lazy"
    />
  </div>
</figure>

### Global Planner

Since the competition provides the static layout ahead of time, we pre-bake a 3D ground-truth signed distance map with all arena features: walls, outer nets, gates (ordered checkpoint sequences), +5 pt bonus window, and landing pad.

This prior is fed into a 2D grid A\* planner at flight altitude with a corridor-centering cost heuristic which pulls paths towards the middle of passages. The raw A\* output is conservative and jagged, so we run a two-stage **geometric** and **kinodynamic optimization pass** to build a smooth, time-indexed reference trajectory:

#### 1. Geometric Optimization

- **Gate overshoot pinning**: Instead of aiming at the gate's center (which can cause horizon-based planners to cut corners, undervaluing the closest gate waypoint), we pin a vertex 0.18 - 0.30 m past the gate center to ensure we don't pull a path short.

  <figure class="figure">
    <div class="media-frame dark-frame">
      <img
        src="/media/planner-pinning.png"
        alt="On the real course, aiming at checkpoint 1's centre rounds the U-turn off 5 cm before the line; the planner's pinned vertex 0.20 m past it clears the line by 19 cm"
        width="3200"
        height="1360"
        loading="lazy"
      />
    </div>
  </figure>

- **Line of sight short-cutting**: We remove redundant collinear waypoints while respecting wall clearance (we keep the redundancy the overshoot pinning adds for above reasons.)
- **Chaikin corner-cutting**: We run 4 iterations of subdivisions to turn discrete waypoint turns into smoother, continuous curves (keeping gate crossings locked for safety)

  <figure class="figure">
    <div class="media-frame dark-frame">
      <img
        src="/media/planner-smoothing.png"
        alt="The launch-to-Gate-A path after the shortcut, Chaikin ×1, Chaikin ×4 and a uniform 2 cm resample, with the pinned checkpoint vertex kept throughout"
        width="3200"
        height="1240"
        loading="lazy"
      />
    </div>
  </figure>

- **Uniform arc-length resampling**: Finally, we resample the curve at uniform 2cm intervals so curvature and velocity profiles are smooth and integrable by the dynamics pass, up next.

#### 2. Kinodynamic Optimization

- **Curvature & yaw-rate capping**: We impose a cruise speed limit (1.5 m/s), a centripetal / lateral acceleration limit (3.0 m/s^2), a yaw-rate limit (45 deg/s) so the forward depth camera never lags behind the direction of travel and clamp the speed at gate crossing waypoints.
- **Forward pass**: (0 -> n - 1) propagates thrust limits forward. It ensures that after hovering or coming out of a slow corner, we clamp the trajectory to have physically reachable speeds.
- **Backward pass**: (n-1 -> 0) propagates braking limits backward. If a waypoint requires the drone to slow down to 0.4 m/s for a hairpin turn or final stop, the backward pass starts braking well in advance.

> If the local planner detects an impassable, unmodeled obstacle blocking a corridor in flight, it fires a replan trigger with the obstacle's coordinates; A\* carves that region out of the map and splices a new global route on the fly from the drone's current velocity.

### Estimation Stack

Raw IMU dead-reckoning cannot be trusted after a couple seconds due to vibrations and sensor inaccuracy. At the flight controller level, we fuse **cuVSLAM** (30 Hz stereo VIO from the OAK-D S2's 640x400 monochrome pair) along with a downward **optical flow sensor** and **rangefinder** into PX4's EKF2.

Even with VIO and optical flow, odometry still accumulates yaw and scale drift over a 15 m maze. To give the planner a locally consistent world frame without shocking EKF2 with violent pose updates, we feed our vehicle odometry and a 15 Hz stereo depth stream into a **local planning-only GTSAM iSAM2 factor graph**.

- A new keyframe is spawned every **0.25m, 10 degrees turned, or 0.5s of motion**. The graph fuses PX4 odometry factors, attitude priors, body-frame velocity factors (prevents yaw drift from leaking into velocity), and **point-to-plane depth ICP** factors against the previous keyframe and older keyframes the drone may happen to fly near (within 1.5 m).
- Because the floor often drops out of the camera's vertical FOV at flight height, vertical walls alone leave altitude unobservable to depth ICP. We regularize unobserved axes and down-weight vertical information by 50x so iSAM2 automatically trusts PX4's rangefinder-backed altitude.
- At each keyframe, iSAM2 also updates a local 3D obstacle grid so the planner can react to shifted walls and unmodeled obstacles.

> This solution cuts final position and heading error by around ~2.5x with keyframe updates taking about 12-20ms on our course-scan benchmark.

<div class="classical-demo figure">
  <figure
    class="rerun-player"
    data-rrd="/media/rerun/isam2.rrd"
    data-rbl="/media/rerun/dronehack_isam2.rbl"
    data-timeline="sim_time"
    data-start-nanos="400000000"
    data-video="/media/clip-3.mp4"
    data-poster="/media/classical-localization.png"
    data-video-label="Classical Approach localization video"
    aria-label="Classical Approach localization Rerun viewer"
  ></figure>
  <div class="viz-legend" aria-label="iSAM2 visualization legend">
    <div class="viz-legend-row">
      <span class="viz-group-label">Trajectories</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #e63c3c"></i><strong>PX4 Odom</strong> (drifting VIO)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #3cdc3c"></i><strong>Ground Truth</strong></span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #468cff"></i><strong>iSAM2 Update</strong> (smoothed)</span>
    </div>
    <div class="viz-legend-row">
      <span class="viz-group-label">Voxels</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #3b82f6"></i><strong>Blue Map:</strong> full global depth map aligned at smoothed keyframe poses</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #ff8c00"></i><strong>Orange Obstacles:</strong> active local voxel window fed to MPPI</span>
    </div>
  </div>
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>

### Local Planner

Tracking a global path through 0.5m corridors when walls are slightly shifted from the prior map requires more than a simple PID carrot-follower. We wrote a Model Predictive Path Integral (MPPI) controller in C++ running at 50 Hz on the CPU with OpenMP to optimize velocity and yaw-rate commands simultaneously.

#### Rolling out the actual drone, not a point mass

Every 20ms, MPPI warm-starts from its previous solution and samples **1,024 noisy control sequences** over an **0.8s** horizon (16 steps x 0.05 s) in the local path-tangent frame.
Instead of stepping a kinematic point mass, each rollout forward-simulates a **1.35 kg deadcat quadrotor with 30 ms of motor lag, aerodynamic drag, and PX4's cascaded PID velocity controller** (uses a similar dynamics model as the RL approach).

If two sample rollouts (left and right around an obstacle) have the same cost, their lateral controls cancel out, and the averaged command vector points to the center. To prevent this, we inject a +/- 0.95 m/s cross-track velocity offset on **35% of rollouts** so the sample cloud splits into both valleys instead of clustering around zero.

> Because MPPI rolls out PX4's actual velocity loop and motor time constants, it predicts pitch and roll transients ahead of time and starts braking _before_ entering a 90° corner.

#### Scoring trajectories & staying inside the net

Rollouts have seven cost terms plus arena altitude and net barriers:

1. **Path follow & velocity alignment**: 3D position and velocity of reference trajectory
2. **3-source obstacle clearance**: Takes minimum distance across static course walls and iSAM2's output distance grid, with an adaptive comfort radius ('0.42 m' down to '0.23 m' in tight gates).
3. **Camera orientation (FOV alignment)**: Penalizes yaw deviation from corridor tangent and penalizes horizontal motion that drifts outside the depth camera's FOV, forcing the drone to look where it flies.
4. **Control slew rate & terminal goal**: Penalizes aggressive command chatter and rewards terminal progress along the path.

Before any commands go out to the flight controller, we run a couple final checks:

- **Map-frame Exponential CBF**: An Exponential Control Barrier Function transforms the commanded velocity into the arena map frame and clamps outward velocity whenever the drone approaches the outer net.
- **Blocked path plan retrigger**: If something blocks the corridor centerline with no clearance, or if the minimum rollout cost spikes for 6 MPPI ticks, we command an immediate hold and trigger a global A\* replan.

<div class="classical-demo figure">
  <figure
    class="rerun-player"
    data-rrd="/media/rerun/mppi.rrd"
    data-rbl="/media/rerun/mppi_blueprint.rbl"
    data-timeline="time"
    data-start-nanos="5200000000"
    data-video="/media/clip-4.mp4"
    data-poster="/media/classical-planning.png"
    data-video-label="Classical Approach planning video"
    aria-label="Classical Approach planning Rerun viewer"
  ></figure>
  <div class="viz-legend" aria-label="MPPI visualization legend">
    <div class="viz-legend-row">
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #00e676"></i><strong>Ground-Truth Reference</strong> (global A* path)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #ffd700"></i><strong>Taken Path</strong> (live 50 Hz MPPI trajectory)</span>
      <span class="viz-item"><i class="viz-swatch viz-ring" style="--c: #ef4444"></i><strong>Arena Obstacles</strong> (unmodeled pillars/crates invisible to A*)</span>
    </div>
  </div>
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>

### Results

Well, we don't really have any hardware flight clips for this one. With limited flight slots and the clock ticking down, we put all our chips on our zero-shot RL policy and never got to fly the classical stack on the real drone, even though it handled our Gazebo simulation and unmodeled-obstacle tests really well.

At least the graphs look pretty.
