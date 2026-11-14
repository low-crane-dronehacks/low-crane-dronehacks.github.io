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

Since the competition provides the static layout ahead of time, we pre-bake a 3D ground-truth signed distance map with all arena features: walls, outer nets, gates (ordered checkpoint sequence), the +5 pt bonus window, and the landing pad.

This prior is fed into a 2D grid A\* planner at flight altitude with a corridor-centering cost heuristic that pulls paths toward the middle of passages. The raw A\* output is conservative and jagged, so we run a two-stage geometric and kinodynamic optimization pass to build a smooth, time-indexed reference trajectory:

#### 1. Geometric Optimization

- Gate overshoot pinning: Instead of aiming at the gate's center (which can cause horizon-based planners to cut corners, undervaluing the closest gate waypoint), we pin a vertex 0.18 - 0.30 m past the gate center to ensure we don't pull a path short.

  <figure class="figure">
    <div class="media-frame dark-frame">
      <img
        src="/media/planner-pinning.png"
        alt="On the real course, aiming at checkpoint 1's center rounds the U-turn off 5 cm before the line; the planner's pinned vertex 0.20 m past it clears the line by 19 cm"
        width="3200"
        height="1360"
        loading="lazy"
      />
    </div>
  </figure>

- Line-of-sight shortcutting: We remove redundant collinear waypoints while respecting wall clearance (we keep the redundancy the overshoot pinning adds for the reason above).
- Chaikin corner-cutting: We run 4 subdivision iterations to turn discrete waypoint turns into smoother, continuous curves (keeping gate crossings locked for safety).

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

- Uniform arc-length resampling: Finally, we resample the curve at uniform 2 cm intervals so curvature and velocity profiles are smooth and integrable by the dynamics pass, up next.

#### 2. Kinodynamic Optimization

- Curvature & yaw-rate capping: We impose a cruise speed limit (1.5 m/s), a centripetal / lateral acceleration limit (3.0 m/s²), and a yaw-rate limit (45 deg/s)—so the forward depth camera never lags behind the direction of travel—and clamp the speed at gate-crossing waypoints.
- Forward pass: Runs from 0 to n - 1, propagating thrust limits forward. It ensures that after hovering or coming out of a slow corner, we clamp the trajectory to have physically reachable speeds.
- Backward pass: Runs from n - 1 to 0, propagating braking limits backward. If a waypoint requires the drone to slow down to 0.4 m/s for a hairpin turn or final stop, the backward pass starts braking well in advance.

> If the local planner detects an impassable, unmodeled obstacle blocking a corridor in flight, it fires a replan trigger with the obstacle's coordinates; A\* carves that region out of the map and splices a new global route on the fly from the drone's current velocity.

### Estimation Stack

<div class="pair"><div>

#### The problem: VIO drifts

We run cuVSLAM for VIO on the OAK-D camera's stereo pair, which gives a good estimate of the drone's position as it flies. But:

- VIO drifts over time.
- We may not know our initial pose exactly.

Left uncorrected, the error adds up, and by the end of the course we would likely have crashed.

</div><div>

#### The fix: a factor graph with a CAD prior

We localize against the given CAD model, treating it as a prior rather than ground truth. As the drone flies, its poses and depth point clouds feed an iSAM2 factor graph that fuses:

- PX4's EKF estimate (IMU, onboard rangefinder and VIO)
- Point-to-plane depth ICP against the previous keyframe
- Depth ICP against older keyframes the drone flies near (within 1.5 m)

</div></div>

This makes full use of the prior map while staying robust to a course that doesn't match it. When the depth point cloud sees an obstacle that isn't in the map, or a wall that has shifted, iSAM2 corrects its estimates. We get:

- Accurate localization, even as VIO drifts
- An updated map that matches reality (more on how we use it later)

#### Demo

The factor graph is given the arena's CAD model as a prior. The real course (ghost) stays hidden and shows up only through the depth observations.

- As the drone flies the ground-truth path (green), the prior map (blue) updates as walls shift and new obstacles appear (orange).
- Our estimated path (blue) stays close to ground truth.
- Raw VIO (red) and naive localization (purple) drift significantly.

<div class="classical-demo figure">
  <figure
    class="rerun-player"
    data-rrd="/media/rerun/final_isam2.rrd"
    data-timeline="sim_time"
    data-start-nanos="400000000"
    data-video="/media/classical/isam2_demo.mp4"
    data-poster="/media/classical-localization.png"
    data-video-label="Classical Approach localization video"
    aria-label="Classical Approach localization Rerun viewer"
  ></figure>
  <div class="viz-legend" aria-label="iSAM2 visualization legend">
    <div class="viz-legend-row">
      <span class="viz-group-label">Trajectories</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #14af41"></i><strong>Ground Truth</strong></span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #e12d32"></i><strong>PX4 Odom</strong> (drifting VIO)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #a52dd7"></i><strong>VIO + Standard ICP</strong> (no factor graph)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #195feb"></i><strong>iSAM2</strong> (factor graph + CAD prior)</span>
    </div>
    <div class="viz-legend-row">
      <span class="viz-group-label">Scene &amp; iSAM2 Map</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #2d82d7"></i><strong>Priors:</strong> prebaked CAD obstacles retained by iSAM2</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #ff8719"></i><strong>New / Updated Obstacles:</strong> shifted &amp; unmodeled walls discovered online</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #73ebb9"></i><strong>Cleared Empty Space:</strong> stale CAD priors carved away by depth rays</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #aac3dc"></i><strong>Real Course Ghost:</strong> translucent solid rescan geometry (reference)</span>
    </div>
  </div>
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>

### Local Planner

Tracking a global path through 0.5 m corridors when walls are slightly shifted from the prior map requires more than a simple PID carrot-follower. We wrote a Model Predictive Path Integral (MPPI) controller in C++ running at 50 Hz on the CPU with OpenMP to optimize velocity and yaw-rate commands simultaneously.

#### Rolling out the actual drone, not a point mass

Every 20 ms, MPPI warm-starts from its previous solution and samples 1,024 noisy control sequences over an 0.8 s horizon (16 steps × 0.05 s) in the local path-tangent frame.
Instead of stepping a kinematic point mass, each rollout forward-simulates a 1.35 kg deadcat quadrotor with 30 ms of motor lag, aerodynamic drag, and PX4's cascaded PID velocity controller (using a dynamics model similar to the RL approach).

If two sample rollouts (left and right around an obstacle) have the same cost, their lateral controls cancel out, and the averaged command vector points to the center. To prevent this, we inject a ±0.95 m/s cross-track velocity offset on 35% of rollouts so the sample cloud splits into both valleys instead of clustering around zero.

> Because MPPI rolls out PX4's actual velocity loop and motor time constants, it predicts pitch and roll transients ahead of time and starts braking _before_ entering a 90° corner.

#### Scoring trajectories & staying inside the net

Rollouts have seven cost terms plus arena altitude and net barriers:

1. Path follow & velocity alignment: Tracks the 3D position and velocity of the reference trajectory.
2. Multi-source obstacle clearance: Takes the minimum distance across static course walls and iSAM2's output distance grid, with an adaptive comfort radius (0.42 m down to 0.23 m in tight gates).
3. Camera orientation (FOV alignment): Penalizes yaw deviation from the corridor tangent and penalizes horizontal motion that drifts outside the depth camera's FOV, forcing the drone to look where it flies.
4. Control slew rate & terminal goal: Penalizes aggressive command chatter and rewards terminal progress along the path.

Before any commands go out to the flight controller, we run a couple of final checks:

- Map-frame Exponential CBF: An Exponential Control Barrier Function transforms the commanded velocity into the arena map frame and clamps outward velocity whenever the drone approaches the outer net.
- Blocked-path replan trigger: If something blocks the corridor centerline with no clearance, or if the minimum rollout cost spikes for 6 MPPI ticks, we command an immediate hold and trigger a global A\* replan.

#### Demo

In this demo, we feed the MPPI planner the reference trajectory and privileged odometry and place arbitrary obstacles in the flight path to demonstrate obstacle avoidance. As the drone flies, you can watch the MPPI controller roll out and sample collision-free paths while still maintaining the mission trajectory.

<div class="classical-demo figure">
  <figure
    class="rerun-player"
    data-rrd="/media/rerun/final_mppi.rrd"
    data-timeline="time"
    data-start-nanos="5200000000"
    data-video="/media/classical/mppi_demo.mp4"
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

Well, we don't really have any hardware flight clips for this one. With limited flight slots and the clock ticking down, we put all our chips on our zero-shot RL policy and never got to fly the classical stack on the real drone.

Below is a screen recording of the full classical system running the full competition course closed-loop. iSAM2 adapts the pre-baked CAD prior online, carving stale walls and replanning when corridors or window heights differ from CAD.

<div class="classical-demo figure">
  <figure
    class="rerun-player"
    data-rrd="/media/rerun/final_full.rrd"
    data-timeline="time"
    data-video="/media/classical/full_demo.mp4"
    data-video-label="Classical Approach full system video"
    aria-label="Classical Approach full system Rerun viewer"
  ></figure>
  <div class="viz-legend" aria-label="Classical autonomy and iSAM2 visualization legend">
    <div class="viz-legend-row">
      <span class="viz-group-label">Trajectories</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #14af41"></i><strong>Ground Truth</strong> (QuadPlant)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #195feb"></i><strong>iSAM2 Estimate</strong> (drift-corrected)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #00ff87"></i><strong>A* Global Path</strong> (live replanning)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #00bfff"></i><strong>Local Horizon &amp; Vel Cmd</strong></span>
    </div>
    <div class="viz-legend-row">
      <span class="viz-group-label">MPPI &amp; Events</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #1a8cff"></i><strong>MPPI Optimal Rollout</strong></span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #38d91a"></i><strong>MPPI Rollout Fan</strong> (green = low cost &rarr; red = high cost)</span>
      <span class="viz-item"><i class="viz-swatch viz-line" style="--c: #ff8c00"></i><strong>Predicted Heading</strong></span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #ff374b"></i><strong>Blocked-Corridor Replan Trigger</strong></span>
      <span class="viz-item"><i class="viz-swatch viz-ring" style="--c: #ffd700"></i><strong>Drone Collision Ring</strong> (0.21 m)</span>
    </div>
    <div class="viz-legend-row">
      <span class="viz-group-label">Arena &amp; Voxels</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #2d82d7"></i><strong>Blue Priors:</strong> remaining uncarved CAD obstacle voxels</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #ff8719"></i><strong>Orange Obstacles:</strong> newly observed / shifted scan walls</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #73ebb9"></i><strong>Mint Volume:</strong> stale CAD prior carved as free space</span>
      <span class="viz-item"><i class="viz-swatch viz-box" style="--c: #aac3dc"></i><strong>Ghosted Meshes &amp; RGB Cloud:</strong> physical <code>.ply</code> arena scan</span>
    </div>
  </div>
  <p class="desktop-viz-hint" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
    <span>Open on desktop to explore the interactive 3D Rerun visualizer</span>
  </p>
</div>
