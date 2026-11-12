### Our Learning Approach: Sparse Rewards

To ensure we could train an optimal policy fast without having to tune reward functions, we used a sparse reward formulation which only rewarded the agent **+1 for landing on the final pad**. No penalty for collisions, just terminating the episode.

#### So how does the agent learn?

Clearly if you send PPO at this problem, it will never get any signal and try random actions for eternity. So, in order to give it a signal, we sample achievable start states based on rolling success (idea credit: [https://sgs-rl.github.io/](https://sgs-rl.github.io/)).

1. Thousands of initial states are uniformly sampled (plus some extra bias to the start and end).
2. The policy's performance is tracked over training.
3. As the policy learns, we prioritize **50% success: not too hard, and not too easy**.

> This drastically improves sample efficiency and exploration, and enables PPO to solve the task.
