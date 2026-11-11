## Deployment and Results

<!-- Write this section's text and bullets in Markdown here. -->

- Tuned optical flow range noise and fine-tuned the sensor in simulation for resilience.
- Worked around unreliable data, including distance sensor and VIO dropouts.
- Found that CuVSLAM caused extreme buffering of bursty monochrome data.
- The provided separate container caused slowdowns from memory copies between partitions instead of the efficient memory moves ROS 2 is designed around.
- Filled missing depth pixels with nearest-neighbor values to give RL a smoother input.
- Switched execution nodes from Python to C++ to improve numerical calculations.
