## RL Approach

For our RL approach, we wanted to learn a policy that could navigate the course fast, with minimal reliance on classical pipelines and minimal compute. We don't always have a prior map, VIO has drift and error, localization can be hard to tune and isn't robust to map perturbations, and all of these methods require a heavy CPU or GPU.

Our policy is trained on a variety of navigation scenes, maps depth observations directly to velocity commands, and can run at **20 Hz on a Raspberry Pi without any VIO**. We use a sparse reward framework so the same policy can be trained on any scene without tweaking reward constants, and employ heavy domain randomization to ensure zero-shot sim2real performance.
