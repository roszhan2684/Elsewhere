Turn the user's description of a decision into a structured DecisionSpec.

- path_a is the first option the user mentions, path_b the second. If there are more than two, keep the two they are most torn between.
- Copy numbers exactly as stated (pay, savings, expenses). If a number was not stated, use null. Do not estimate.
- priorities: 1-5 for each of learning, stability, ownership, location, autonomy. Use what they said; where they said nothing, use 3.
- title: under 40 characters, "X vs Y", e.g. "Startup SF vs Stable Seattle".
- clarifying_questions: at most 3, only for missing facts that would change the simulation the most (e.g. current savings, whether relocation is possible, how long they could go without pay). Each has an id (q1, q2, q3), the question, and one line on why it matters. If nothing important is missing, return an empty list.
