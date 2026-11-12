### Solving Sim2Real

Once we learned the task in a perfect environment, we needed to ensure the policy would fly in the real world: a different plant, noisy depth images, and a different environment. To solve this, we added heavy domain randomization on everything we could possibly think of. We wanted to ensure that no matter what we saw in the real world, the policy would know how to handle it.

> Since we had limited flight experiments and no ground truth to tweak with, this was absolutely crucial (and everyone we talked to thought it was impossible!).

#### Dynamics and sensing

To start, we added noise to realistic drone dynamics, proprioception and sensing, and modeled battery sag and action latency, among a few others. But this didn't concern us. Vision-based policies can easily overfit to particular visual features that may not be obvious when designing an environment. We identified three primary concerns:

1. A slightly different environment layout in real life
2. Depth noise from the OAK-D's camera model
3. Primarily, the background

#### 1. Layout

For the first, we modeled perturbations of the environment and added them as additional scenes the policy trains on. We shifted the:

- Wall positions, angles, lengths, thickness, and centerline offsets
- Ground objects
- Position of the open window in the wall

> We actually forgot the window until our first flight, which crashed at the window and was the only sim2real gap we forgot to close!

#### 2. Depth noise

Depth noise was also a significant concern, and the OAK-D in particular has a very peculiar noise pattern. Since we have no way of knowing how it performs stereo matching, we decided to not use the precomputed depth image.

Instead, we ran **NVIDIA VPI** to perform SGM on the Jetson from the OAK-D's stereo camera streams. This way, we could use **the exact same algorithm and noise pattern in simulation** to reduce any potential sim2real gap.

#### 3. Background

Finally, we needed to model the background. This was our biggest concern, as the boundary walls in real life are not solid walls, but **nets which are invisible to the depth camera**. Additionally, there can be a variety of possible objects or scenes in the background.

Initially, the policy was struggling to learn when we removed the boundary walls, since it can be hard to distinguish between navigable free space and "out of bounds". We quickly adapted by **adding random objects or walls in the background**, so that the policy would treat a random background scene as noise, but also a signal to stay on course.

We also noticed that there were structural poles every 5 ft to hang the netting, so we modeled those in simulation as well, thinking that maybe the policy could use it as a signal to stay on track.

> We later were concerned this could actually cause a sim2real gap, since in real life they are thin, textureless, and have glare, tough for stereo matching. However, we did evaluations of the policy with the bars removed and it showed a minimal performance drop.

#### Result

All of these tricks combined resulted in a policy that showed **no sim2real gap**. We even tested the policy in an out-of-distribution (OOD) open room and saw a trajectory very similar to the one in simulation.
