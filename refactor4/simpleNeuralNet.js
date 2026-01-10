class Level {
    constructor(inputCount, outputCount) {
        this.inputs = new Float32Array(inputCount);
        this.outputs = new Float32Array(outputCount);
        this.biases = new Float32Array(outputCount);
        this.weights = new Float32Array(inputCount * outputCount);
        this.randomize();
    }

    randomize() {
        for (let i = 0; i < this.inputs.length; i++) this.inputs[i] = 0; // Clear inputs just in case
        for (let i = 0; i < this.outputs.length; i++) this.outputs[i] = 0;
        for (let i = 0; i < this.biases.length; i++) this.biases[i] = Math.random() * 2 - 1;
        for (let i = 0; i < this.weights.length; i++) this.weights[i] = Math.random() * 2 - 1;
    }

    mutate(amount) {
        const adjust = (val) => val + (Math.random() * 2 - 1) * amount;
        for (let i = 0; i < this.weights.length; i++) this.weights[i] = adjust(this.weights[i]);
        for (let i = 0; i < this.biases.length; i++) this.biases[i] = adjust(this.biases[i]);
    }

    feedForward(givenInputs) {
        for (let i = 0; i < this.inputs.length; i++) {
            this.inputs[i] = givenInputs[i];
        }

        for (let i = 0; i < this.outputs.length; i++) {
            let sum = 0;
            for (let j = 0; j < this.inputs.length; j++) {
                sum += this.inputs[j] * this.weights[j * this.outputs.length + i];
            }
            // Use Tanh activation
            this.outputs[i] = Math.tanh(sum + this.biases[i]);
        }
        return this.outputs;
    }

    clone() {
        const level = new Level(this.inputs.length, this.outputs.length);
        level.weights.set(this.weights);
        level.biases.set(this.biases);
        return level;
    }
}

export class SimpleNeuralNetwork {
    constructor(neuronCounts) {
        this.neuronCounts = neuronCounts; // Store config
        this.levels = [];
        for (let i = 0; i < neuronCounts.length - 1; i++) {
            this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1]));
        }
    }

    clone() {
        const clone = new SimpleNeuralNetwork(this.neuronCounts);
        for (let i = 0; i < this.levels.length; i++) {
            clone.levels[i] = this.levels[i].clone();
        }
        return clone;
    }

    serialize() {
        return {
            neuronCounts: this.neuronCounts,
            levels: this.levels.map(l => ({
                weights: Array.from(l.weights),
                biases: Array.from(l.biases)
            }))
        };
    }

    static deserialize(data) {
        if (!data || !data.neuronCounts) return null;
        const brain = new SimpleNeuralNetwork(data.neuronCounts);
        brain.levels.forEach((level, i) => {
            if (data.levels[i]) {
                level.weights.set(data.levels[i].weights);
                level.biases.set(data.levels[i].biases);
            }
        });
        return brain;
    }

    static crossover(brainA, brainB) {
        // Assume same topology
        const child = new SimpleNeuralNetwork(brainA.neuronCounts);

        for (let l = 0; l < child.levels.length; l++) {
            const levelC = child.levels[l];
            const levelA = brainA.levels[l];
            const levelB = brainB.levels[l];

            // Random crossover point or coin flip per weight?
            // Let's do coin flip per weight for diversity
            for (let i = 0; i < levelC.weights.length; i++) {
                levelC.weights[i] = Math.random() < 0.5 ? levelA.weights[i] : levelB.weights[i];
            }
            for (let i = 0; i < levelC.biases.length; i++) {
                levelC.biases[i] = Math.random() < 0.5 ? levelA.biases[i] : levelB.biases[i];
            }
        }
        return child;
    }

    randomize() {
        this.levels.forEach(level => level.randomize());
    }

    mutate(amount = 0.1) {
        this.levels.forEach(level => level.mutate(amount));
    }

    feedForward(givenInputs) {
        let outputs = this.levels[0].feedForward(givenInputs);
        for (let i = 1; i < this.levels.length; i++) {
            outputs = this.levels[i].feedForward(outputs);
        }
        return outputs;
    }

    setBraitenbergWeights() {
        this.randomize(); // Reset first to clear garbage

        // PROPAGATE INTENT
        // Level 0: Input -> Hidden 1
        // Level 1: Hidden 1 -> Hidden 2
        // Level 2: Hidden 2 -> Output

        // We want Left Inputs (0-2) to eventually trigger Right Output (1)
        // And Right Inputs (3-5) to eventually trigger Left Output (0)
        // Center (6) -> Both (0,1)

        // STRATEGY: 
        // 1. Connect Inputs strongly to corresponding nodes in Hidden 1.
        // 2. Connect Hidden 1 nodes to Hidden 2 nodes (straight through).
        // 3. Connect Hidden 2 nodes to Output (CROSSING HERE).

        // Assuming structure [9, 12, 8, 2] or similar.
        const L0 = this.levels[0]; // 9 -> 12
        const L1 = this.levels[1]; // 12 -> 8
        const LLast = this.levels[this.levels.length - 1]; // 8 -> 2

        if (this.levels.length < 2) return; // Need at least 2 layers for deep logic

        // --- LEVEL 0: Pass through (Input k -> k) ---
        for (let i = 0; i < L0.inputs.length; i++) {
            // Connect input i to hidden i (if exists)
            if (i < L0.outputs.length) {
                L0.weights[i * L0.outputs.length + i] = 5.0;
            }
        }

        // --- MIDDLE LEVELS: Pass through (k -> k) ---
        for (let l = 1; l < this.levels.length - 1; l++) {
            const level = this.levels[l];
            for (let i = 0; i < level.inputs.length; i++) {
                if (i < level.outputs.length) {
                    level.weights[i * level.outputs.length + i] = 5.0;
                }
            }
        }

        // --- LAST LEVEL: CROSSING LOGIC (The "Brain" Part) ---

        // Map "Left" indices from previous layer to "Right" Output
        // Map "Right" indices from previous layer to "Left" Output

        // We know Inputs 0-2 were Left. If we passed through, they are indices 0-2 in LLast inputs.
        // Inputs 3-5 were Right. Indices 3-5 in LLast.

        // Left (0,1,2 passed to 0,1,2) -> Output R (1)
        for (let i = 0; i <= 2; i++) {
            if (i < LLast.inputs.length) {
                LLast.weights[i * 2 + 1] = 5.0; // Connect to Output 1
            }
        }

        // Right (3,4,5 passed to 3,4,5) -> Output L (0)
        for (let i = 3; i <= 5; i++) {
            if (i < LLast.inputs.length) {
                LLast.weights[i * 2 + 0] = 5.0; // Connect to Output 0
            }
        }
    }
}
