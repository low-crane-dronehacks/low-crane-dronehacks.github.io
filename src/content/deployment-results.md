## Deployment and Results

<!-- Write this section's text and bullets in Markdown here. -->

Since RL worked so well in sim we went on to deploy it, but ran into quite a couple headaches relating to deployment. There was a LOT of time spent cutting down latency and passing frames/data along in our pipeline to the inference model. The biggest issue was the fact that a lot of the pipeline to deploy was made for us to make a working solution really easy (well-done and thank you dronehacks team!), but in the process when we added another container for our code it caused all sorts of multi-process issues & latency. Curses!

Some of the problems that we remember lol:

- Tuned optical flow range noise and fine-tuned the sensor in simulation for resilience.
- Worked around unreliable data, including distance sensor and VIO dropouts.
- Found that CuVSLAM caused extreme buffering of bursty monochrome data.
- The provided separate container caused slowdowns from memory copies between partitions instead of the efficient memory moves ROS 2 is designed around.
- Filled missing depth pixels with nearest-neighbor values to give RL a smoother input.
- Switched execution nodes from Python to C++ to improve numerical calculations.

The drone at the end flew most of the course zero-shot! It hit the window at the end because shifted Z-axis (window height) noise/deformation was outside of the training data, aka we forgot it exists.
