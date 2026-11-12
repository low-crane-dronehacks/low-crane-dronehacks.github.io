### Our Learning Approach: Sparse Rewards

To ensure we could train an optimal policy fast without having to tune reward functions, we used a sparse reward formulation which only rewarded the agent **+1 for landing on the final pad**. No penalty for collisions, just terminating the episode.

So how does the agent learn? Clearly if you send PPO at this problem, it will never get any signal and try random actions for eternity. So, in order to give it a signal, we sample achievable start states based on rolling success (idea credit: [https://sgs-rl.github.io/](https://sgs-rl.github.io/)). Thousands of initial states are uniformly sampled (plus some extra bias to the start and end), and the policy's performance is tracked over training. As the policy learns, we prioritize **50% success: not too hard, and not too easy**, drastically improving sample efficiency and exploration, and enabling PPO to solve the task.
