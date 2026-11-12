## Classical Approach

For our classical approach, we wanted a stack that wouldn't let the drone drift into a wall or fly straight through the outer net. Instead of trusting raw VIO and a basic waypoint follower, we put together a C++ autonomy pipeline covering global planning, factor-graph localization, and sampling-based local control.

<div class="pair"><div>

#### Why build a classical stack too?

- We already get the rough course layout and gate order ahead of time
- VIO drifts over long corridors, and stereo depth likes to punch holes through thin walls
- A deterministic C++ controller gives us hard safety bounds if an RL policy ever goes rogue

</div><div>

#### Our pipeline

- Corridor-centered **A\*** with path smoothing and heading-aware speed limits
- **GTSAM iSAM2** factor graph running depth ICP on keyframes to cancel odometry drift
- **50 Hz MPPI** rolling out 1,024 trajectories through our 6-DoF quadrotor dynamics

</div></div>

### Global Planner

Since the competition provides the static layout ahead of time, we bake the walls, outer nets, gates, bonus window, and landing pad into a signed distance map.

On top of that, we run a 2D **A\*** search at flight altitude with a corridor-centering cost that pulls paths toward the middle of narrow passages and relaxes clearance right at tight gate openings. Raw grid A\* is pretty jagged on its own, so we clean it up in two passes before handing it to the controller:

1. **Path smoothing:** If you just aim for the center of a gate, any downstream smoother or local planner will cut the corner early and miss the scoring plane. To fix this, we pin waypoints slightly _past_ each gate, prune extra grid vertices with line-of-sight shortcutting, and smooth out the sharp turns with Chaikin corner-cutting.
2. **Speed profiling:** Beyond capping lateral acceleration in turns, we also cap speed based on yaw rate along the curve so the forward depth camera never lags behind the direction of travel in tight chicanes.

> If the local planner runs into an unmodeled obstacle blocking a corridor mid-flight, A\* carves that spot out of the map and splices in a new route on the fly.

### Perception Stack

Raw IMU dead-reckoning is useless after a couple seconds. At the flight controller level, PX4's EKF2 fuses stereo VIO from **cuVSLAM** with a downward optical flow sensor and rangefinder.

Even with VIO and optical flow, odometry still picks up yaw and scale drift over a 15 m maze. Feeding map corrections straight back into PX4's estimator is asking for violent control jumps, so we kept localization strictly on the planning side using a **GTSAM iSAM2** factor graph:

- Every short step of motion or turn, we drop a new keyframe combining PX4 relative odometry, gravity-aligned roll/pitch priors, and point-to-plane **depth ICP** against nearby and revisited keyframes.
- Because the floor often drops out of the camera's vertical field of view at flight height, vertical walls alone leave altitude unobservable to ICP. We regularize unobserved axes so the graph leans on the rangefinder for height instead of drifting vertically.
- On our course scan benchmark with injected VIO drift, this cut final position and heading error by about **2.5x** while keeping keyframe updates under 20 ms.

At each keyframe, iSAM2 also updates a local 3D obstacle grid so the planner can react to shifted walls and unmodeled obstacles.

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
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>

### Local Planner

Tracking a path through half-meter corridors when real walls don't quite match the prior map takes more than a PID carrot-follower. We wrote a **Model Predictive Path Integral (MPPI)** controller in C++ running at **50 Hz** on the CPU with OpenMP to optimize velocity and yaw rate together.

#### Rolling out the actual drone

At each control tick, MPPI warm-starts from its last solution and samples **1,024 noisy control rollouts** a little under a second into the future. Instead of stepping a simple point mass, every rollout simulates our full **6-DoF quadrotor model**, including motor lag, drag, and PX4's velocity loop. Because it sees pitch and roll transients coming, it naturally starts braking _before_ diving into a 90-degree corner.

One classic failure mode of sampling planners is when left and right trajectories around a centered obstacle average together into a head-on crash. To avoid that, we bias a chunk of our samples laterally in both directions so the rollout cloud splits cleanly around obstacles in the middle of a hall.

#### Scoring trajectories & staying inside the net

Rollouts are scored on reference tracking, control smoothness, and obstacle clearance across both the prior walls (so stereo dropouts can't trick the drone into flying through a wall) and live depth data. We also penalize motion that drifts outside the camera's horizontal field of view, forcing the drone to look where it flies instead of swinging blind around corners.

Before commands go out to the flight controller, we run a couple final checks:

- **Perimeter barrier:** Since the outer arena nets are basically invisible to stereo depth, a **Control Barrier Function (CBF)** smoothly clamps outward velocity whenever the drone gets close to the boundary in the map frame.
- **Stuck detection & muxing:** If a corridor is completely blocked and rollout costs spike for several ticks, MPPI holds position and triggers a global replan. A lightweight multiplexer sits at the end of the pipeline to switch cleanly between MPPI and our RL policy while watching for stale data or VIO dropouts.

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
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>

### Results

Well, we don't really have any hardware flight clips for this one. With limited flight slots and the clock ticking down, we put all our chips on our zero-shot RL policy and never got to fly the classical stack on the real drone, even though it handled our Gazebo simulation and unmodeled-obstacle tests really well.

At least the visualizations look pretty.
