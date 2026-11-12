## RL Approach

For our RL approach, we wanted to learn a policy that could navigate the course fast, with minimal reliance on classical pipelines and minimal compute.

<div class="pair"><div>

#### Why not a classical pipeline?

- We don't always have a prior map
- VIO has drift and error
- Localization can be hard to tune and isn't robust to map perturbations
- All of these methods require a heavy CPU or GPU

</div><div>

#### Our policy

- Is trained on a variety of navigation scenes
- Maps depth observations directly to velocity commands
- Can run at 100 Hz on a Raspberry Pi without any VIO

</div></div>

We use a sparse reward framework so the same policy can be trained on any scene without tweaking reward constants, and employ heavy domain randomization to ensure zero-shot sim2real performance.
