/*globals paper, console, $ */
/*jslint nomen: true, undef: true, sloppy: true */

// network art library

/*

@licstart  The following is the entire license notice for the
JavaScript code in this page.

Copyright (C) 2015 david ha, otoro.net, otoro labs

The JavaScript code in this page is free software: you can
redistribute it and/or modify it under the terms of the GNU
General Public License (GNU GPL) as published by the Free Software
Foundation, either version 3 of the License, or (at your option)
any later version.  The code is distributed WITHOUT ANY WARRANTY;
without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.

As additional permission under GNU GPL version 3 section 7, you
may distribute non-source (e.g., minimized or compacted) forms of
that code without the copy of the GNU GPL normally required by
section 4, provided you include this license notice and a URL
through which recipients can access the Corresponding Source.


@licend  The above is the entire license notice
for the JavaScript code in this page.
*/

// implementation of neat algorithm with recurrent.js graphs to support backprop
// used for genetic art.
// code is not modular or oop, ad done in a fortran/scientific computing style
// apologies in advance if that ain't ur taste.
if (typeof module != "undefined") {
  var R = require('./recurrent.js');
  //var NetArt = require('./netart.js');
}

var N = {};

(function(global) {
  "use strict";

  // Utility fun
  function assert(condition, message) {
    // from http://stackoverflow.com/questions/15313418/javascript-assert
    if (!condition) {
      message = message || "Assertion failed";
      if (typeof Error !== "undefined") {
        throw new Error(message);
      }
      throw message; // Fallback
    }
  }

  // constants
  var NODE_INPUT = 0;
  var NODE_OUTPUT = 1;
  var NODE_BIAS = 2;
  // hidden layers
  var NODE_SIGMOID = 3;
  var NODE_TANH = 4;
  var NODE_RELU = 5;
  var NODE_GAUSSIAN = 6;
  var NODE_SIN = 7;
  var NODE_COS = 8;
  var NODE_ABS = 9;
  var NODE_MULT = 10;
  var NODE_ADD = 11;
  var NODE_MGAUSSIAN = 12; // multi-dim gaussian (do gaussian to each input then mult)
  var NODE_SQUARE = 13;

  var NODE_INIT = NODE_ADD;

  var MAX_TICK = 100;

  var operators = [null, null, null, 'sigmoid', 'tanh', 'relu', 'gaussian', 'sin', 'cos', 'abs', 'mult', 'add', 'mult', 'add'];

  // for connections
  var IDX_CONNECTION = 0;
  var IDX_WEIGHT = 1;
  var IDX_ACTIVE = 2;

  //var activations = [NODE_SIGMOID, NODE_TANH, NODE_RELU, NODE_GAUSSIAN, NODE_SIN, NODE_COS, NODE_MULT, NODE_ABS, NODE_ADD, NODE_MGAUSSIAN, NODE_SQUARE];
  var activations = [NODE_SIGMOID, NODE_TANH, NODE_RELU, NODE_GAUSSIAN, NODE_SIN, NODE_COS, NODE_ADD];

  var getRandomActivation = function() {
    var ix = R.randi(0, activations.length);
    return activations[ix];
  };

  var gid = 0;
  var getGID = function() {
    var result = gid;
    gid += 1;
    return result;
  };

  var nodes = []; // this array holds all nodes
  var connections = []; // index of connections here is the 'innovation' value

  var copyArray = function(x) {
    // returns a copy of floatArray
    var n = x.length;
    var result = new Array(n);
    for (var i=0;i<n;i++) {
      result[i]=x[i];
    }
    return result;
  };

  function copyConnections(newC) {
    var i, n;
    n = newC.length;
    var copyC = [];
    for (i=0;i<n;i++) { // connects input and bias to init dummy node
      copyC.push([newC[i][0], newC[i][1]]);
    }
    return copyC;
  }

  var getNodes = function() {
    return copyArray(nodes);
  };

  var getConnections = function() {
    return copyConnections(connections);
  };

  var nInput = 1;
  var nOutput = 1;
  var outputIndex = 2; // [bias, input, output]
  var initNodes = [];
  var initMu = 0.0, initStdev = 1.0; // randomised param initialisation.
  var mutationRate = 0.2;
  var mutationSize = 0.5;

  function getRandomRenderMode() {
    // more chance to be 0 (1/2), and then 1/3 to be 1, and 1/6 to be 2
    var z = R.randi(0, 6);
    if (z<3) return 0;
    if (z<5) return 1;
    return 2;
  }

  var renderMode = getRandomRenderMode(); // 0 = sigmoid (1 = gaussian, 2 = tanh+abs

  var randomizeRenderMode = function() {
    renderMode = getRandomRenderMode();
    console.log('render mode = '+renderMode);
  };

  var setRenderMode = function(rMode) {
    renderMode = rMode;
  };

  var getRenderMode = function() {
    return renderMode;
  };

  function getOption(opt, index, orig) {
    if (opt && typeof opt[index] !== null) { return opt[index]; }
    return orig;
  }

  var init = function(opt) {
    var i, j;
    nInput = getOption(opt, 'nInput', nInput);
    nOutput = getOption(opt, 'nOutput', nOutput);
    outputIndex = nInput+1; // index of output start (bias so add 1)
    // initialise nodes
    for (i=0;i<nInput;i++) {
      nodes.push(NODE_INPUT);
    }
    nodes.push(NODE_BIAS);
    for (i=0;i<nOutput;i++) {
      nodes.push(NODE_OUTPUT);
    }
    // initialise connections. at beginning only connect inputs to outputs
    // initially, bias has no connections and that must be grown.

/*
    for (j=0;j<nOutput;j++) {
      for (i=0;i<nInput+1;i++) {
        connections.push([i, outputIndex+j]);
      }
    }
*/

    // push initial dummy node
    nodes.push(NODE_ADD);
    var dummyIndex = nodes.length-1;
    for (i=0;i<nInput+1;i++) { // connects input and bias to init dummy node
      connections.push([i, dummyIndex]);
    }
    for (i=0;i<nOutput;i++) { // connects dummy node to output
      connections.push([dummyIndex, outputIndex+i]);
    }

  };

  function getNodeList(node_type) {
    // returns a list of locations (index of global node array) containing
    // where all the output nodes are
    var i, n;
    var result = [];
    for (i=0,n=nodes.length;i<n;i++) {
      if (nodes[i] === node_type) {
        result.push(i);
      }
    }
    return result;
  }

  var Genome = function(initGenome) {
    var i, j;
    var n;
    var c; // connection storage.

    this.connections = [];
    // create or copy initial connections
    if (initGenome && typeof initGenome.connections !== null) {
      for (i=0,n=initGenome.connections.length;i<n;i++) {
        this.connections.push(R.copy(initGenome.connections[i]));
      }
    } else {

/*
      // copy over initial connections (nInput + connectBias) * nOutput
      for (i=0,n=(nInput+1)*nOutput;i<n;i++) {
        c = R.zeros(3); // innovation number, weight, enabled (1)
        c[IDX_CONNECTION] = i;
        c[IDX_WEIGHT] = R.randn(initMu, initStdev);
        c[IDX_ACTIVE] = 1;
        this.connections.push(c);
      }
*/

      for (i=0,n=(nInput+1)+nOutput;i<n;i++) {
        c = R.zeros(3); // innovation number, weight, enabled (1)
        c[IDX_CONNECTION] = i;
        // the below line assigns 1 to initial weights from dummy node to output
        c[IDX_WEIGHT] = (i < (nInput+1)) ? R.randn(initMu, initStdev) : 1.0;
        //c[IDX_WEIGHT] = R.randn(initMu, initStdev);
        c[IDX_ACTIVE] = 1;
        this.connections.push(c);
      }


    }
  };

  Genome.prototype = {
    copy: function() {
      // makes a copy of itself and return it (returns a Genome class)
      return new Genome(this);
    },
    importConnections: function(cArray) {
      var i, n;
      this.connections = [];
      var temp;
      for (i=0,n=cArray.length;i<n;i++) {
        temp = new R.zeros(3);
        temp[0] = cArray[i][0];
        temp[1] = cArray[i][1];
        temp[2] = cArray[i][2];
        this.connections.push(temp);
      }
    },
    mutateWeights: function(mutationRate_, mutationSize_) {
      // mutates each weight of current genome with a probability of mutationRate
      // by adding a gaussian noise of zero mean and mutationSize stdev to it
      var mRate = mutationRate_ || mutationRate;
      var mSize = mutationSize_ || mutationSize;

      var i, n;
      for (i=0,n=this.connections.length;i<n;i++) {
        if (Math.random() < mRate) {
          this.connections[i][IDX_WEIGHT] += R.randn(0, mSize);
        }
      }
    },
    addRandomNode: function() {
      // adds a new random node and assigns it a random activation gate
      var c = R.randi(0, this.connections.length); // choose random connection
      var w = this.connections[c][1];

      this.connections[c][2] = 0; // disable the connection
      var nodeIndex = nodes.length;
      nodes.push(getRandomActivation()); // create the new node globally

      var innovationNum = this.connections[c][0];
      var fromNodeIndex = connections[innovationNum][0];
      var toNodeIndex = connections[innovationNum][1];

      var connectionIndex = connections.length;
      // make 2 new connection globally
      connections.push([fromNodeIndex, nodeIndex]);
      connections.push([nodeIndex, toNodeIndex]);

      // put in this node locally into genome
      var c1 = R.zeros(3);
      c1[IDX_CONNECTION] = connectionIndex;
      c1[IDX_WEIGHT] = 1.0; // use 1.0 as first connection weight
      c1[IDX_ACTIVE] = 1;
      var c2 = R.zeros(3);
      c2[IDX_CONNECTION] = connectionIndex+1;
      c2[IDX_WEIGHT] = w; // use old weight for 2nd connection
      c2[IDX_ACTIVE] = 1;

      this.connections.push(c1);
      this.connections.push(c2);
    },
    addRandomConnection: function() {
      // attempts to add a random connection.
      // if connection exists, then does nothing (ah well)

      var i, n, connectionIndex, nodeIndex;
      var nodesInUseFlag = R.zeros(nodes.length);
      var nodesInUse = [];

      for (i=0,n=this.connections.length;i<n;i++) {
        connectionIndex = this.connections[i][0];
        nodeIndex = connections[connectionIndex][0];
        nodesInUseFlag[nodeIndex] = 1;
        nodeIndex = connections[connectionIndex][1];
        nodesInUseFlag[nodeIndex] = 1;
      }
      for (i=0,n=nodes.length;i<n;i++) {
        if (nodesInUseFlag[i] === 1) {
          nodesInUse.push(i);
        }
      }

      //var fromNodeIndex = R.randi(0, nodes.length);
      //var toNodeIndex = R.randi(outputIndex, nodes.length); // includes bias.

      var fromNodeIndex = nodesInUse[R.randi(0, nodesInUse.length)];
      var toNodeIndex = nodesInUse[R.randi(outputIndex, nodesInUse.length)];

      var fromNodeUsed = false;
      var toNodeUsed = false;

      if (fromNodeIndex === toNodeIndex) return; // can't be the same index.
      // cannot loop back out from the output.
      if (fromNodeIndex >= outputIndex && fromNodeIndex < (outputIndex+nOutput)) return;

      // the below set of code will test if selected nodes are actually used in network connections
      for (i=0,n=this.connections.length;i<n;i++) {
        connectionIndex = this.connections[i][0];
        if ((connections[connectionIndex][0] === fromNodeIndex) || (connections[connectionIndex][1] === fromNodeIndex)) {
          fromNodeUsed = true; break;
        }
      }
      for (i=0,n=this.connections.length;i<n;i++) {
        connectionIndex = this.connections[i][0];
        if ((connections[connectionIndex][0] === toNodeIndex) || (connections[connectionIndex][1] === toNodeIndex)) {
          toNodeUsed = true; break;
        }
      }
      if (!fromNodeUsed || !toNodeUsed) return; // only consider connections in current net.

      var searchIndex = -1; // see if connection already exist.
      for (i=0,n=connections.length;i<n;i++) {
        if (connections[i][0] === fromNodeIndex && connections[i][1] === toNodeIndex) {
          searchIndex = i; break;
        }
      }


      if (searchIndex < 0) {
        // great, this connection doesn't exist yet!
        connectionIndex = connections.length;
        connections.push([fromNodeIndex, toNodeIndex]);

        var c = R.zeros(3); // innovation number, weight, enabled (1)
        c[IDX_CONNECTION] = connectionIndex;
        c[IDX_WEIGHT] = R.randn(initMu, initStdev);
        c[IDX_ACTIVE] = 1;
        this.connections.push(c);
      } else {
        var connectionIsInGenome = false;
        for (i=0,n=this.connections.length; i<n; i++) {
          if (this.connections[i][IDX_CONNECTION] === searchIndex) {
            // enable back the index (if not enabled)
            this.connections[i][IDX_ACTIVE] = 1;
            connectionIsInGenome = true;
            break;
          }
        }
        if (!connectionIsInGenome) {
          // even though connection exists globally, it isn't in this gene.
          //console.log('even though connection exists globally, it isnt in this gene.');
          var c1 = R.zeros(3); // innovation number, weight, enabled (1)
          c1[IDX_CONNECTION] = searchIndex;
          c1[IDX_WEIGHT] = R.randn(initMu, initStdev);
          c1[IDX_ACTIVE] = 1;
          this.connections.push(c1);
          //console.log('added connection that exists somewhere else but not here.');
        }
      }

    },
    createUnrolledConnections: function() {
      // create a large array that is the size of Genome.connections
      // element:
      // 0: 1 or 0, whether this connection exists in this genome or not
      // 1: weight
      // 2: active? (1 or 0)
      var i, n, m, cIndex, c;
      this.unrolledConnections = [];
      n=connections.length; // global connection length
      m=this.connections.length;
      for (i=0;i<n;i++) {
        this.unrolledConnections.push(R.zeros(3));
      }
      for (i=0;i<m;i++) {
        c = this.connections[i];
        cIndex = c[IDX_CONNECTION];
        this.unrolledConnections[cIndex][IDX_CONNECTION] = 1;
        this.unrolledConnections[cIndex][IDX_WEIGHT] = c[IDX_WEIGHT];
        this.unrolledConnections[cIndex][IDX_ACTIVE] = c[IDX_ACTIVE];
      }
    },
    crossover: function(that) { // input is another genome
      // returns a newly create genome that is the offspring.
      var i, n, c;
      var child = new Genome();
      child.connections = []; // empty initial connections
      var g;
      var count;

      n = connections.length;

      this.createUnrolledConnections();
      that.createUnrolledConnections();

      for (i=0;i<n;i++) {
        count = 0;
        g = this;
        if (this.unrolledConnections[i][IDX_CONNECTION] === 1) {
          count++;
        }
        if (that.unrolledConnections[i][IDX_CONNECTION] === 1) {
          g = that;
          count++;
        }
        if (count === 2 && Math.random() < 0.5) {
          g = this;
        }
        if (count === 0) continue; // both genome doesn't contain this connection
        c = R.zeros(3);
        c[IDX_CONNECTION] = i;
        c[IDX_WEIGHT] = g.unrolledConnections[i][IDX_WEIGHT];
        // in the following line, the connection is disabled only of it is disabled on both parents
        c[IDX_ACTIVE] = 1;
        if (this.unrolledConnections[i][IDX_ACTIVE] === 0 && that.unrolledConnections[i][IDX_ACTIVE] === 0) {
          c[IDX_ACTIVE] = 0;
        }
        child.connections.push(c);
      }

      return child;
    },
    setupModel: function(inputDepth) {
      // setup recurrent.js model
      var i;
      var nNodes = nodes.length;
      var nConnections = connections.length;
      this.createUnrolledConnections();
      this.model = [];
      var nodeModel = [];
      var connectionModel = [];
      var c;
      for (i=0;i<nNodes;i++) {
        nodeModel.push(new R.Mat(inputDepth, 1));
      }
      for (i=0;i<nConnections;i++) {
        c = new R.Mat(1, 1);
        c.w[0] = this.unrolledConnections[i][IDX_WEIGHT];
        connectionModel.push(c);
      }
      this.model.nodes = nodeModel;
      this.model.connections = connectionModel;
    },
    zeroOutNodes: function() {
      R.zeroOutModel(this.model.nodes);
    },
    setInput: function(input) {
      // input is an n x d R.mat, where n is the inputDepth, and d is number of inputs
      // for generative art, d is typically just (x, y)
      // also sets all the biases to be 1.0
      // run this function _after_ setupModel() is called!
      var i, j;
      var n = input.n;
      var d = input.d;
      var inputNodeList = getNodeList(NODE_INPUT);
      var biasNodeList = getNodeList(NODE_BIAS);
      var dBias = biasNodeList.length;

      R.assert(inputNodeList.length === d);
      R.assert(this.model.nodes[0].n === n);

      for (i=0;i<n;i++) {
        for (j=0;j<d;j++) {
          this.model.nodes[inputNodeList[j]].set(i, 0, input.get(i, j));
        }
        for (j=0;j<dBias;j++) {
          this.model.nodes[biasNodeList[j]].set(i, 0, 1.0);
        }
      }
    },
    getOutput: function() {
      // returns an array of recurrent.js Mat's representing the output
      var i;
      var outputNodeList = getNodeList(NODE_OUTPUT);
      var d = outputNodeList.length;
      var output = [];
      for (i=0;i<d;i++) {
        output.push(this.model.nodes[outputNodeList[i]]);
      }
      return output;
    },
    roundWeights: function() {
      var precision = 10000;
      for (var i=0;i<this.connections.length;i++) {
        this.connections[i][IDX_WEIGHT] = Math.round(this.connections[i][IDX_WEIGHT]*precision)/precision;
      }
    },
    toJSON: function(description) {

      var data = {
        nodes: copyArray(nodes),
        connections: copyConnections(connections),
        nInput: nInput,
        nOutput: nOutput,
        renderMode: renderMode,
        outputIndex: outputIndex,
        genome: this.connections,
        description: description
      };

      this.backup = new Genome(this);

      return data;

    },
    fromJSON: function(data) {
      nodes = copyArray(data.nodes);
      connections = copyConnections(data.connections);
      nInput = data.nInput;
      nOutput = data.nOutput;
      renderMode = data.renderMode || 0; // might not exist.
      outputIndex = data.outputIndex;
      this.importConnections(data.genome);

      return data.description;
    },
    forward: function(G) {
      // forward props the network from input to output.  this is where magic happens.
      // input G is a recurrent.js graph
      var outputNodeList = getNodeList(NODE_OUTPUT);
      var biasNodeList = getNodeList(NODE_BIAS);
      var inputNodeList = biasNodeList.concat(getNodeList(NODE_INPUT));

      var i, j, n;
      var nNodes = nodes.length;
      var nConnections = connections.length;
      var touched = R.zeros(nNodes);
      var nodeConnections = new Array(nNodes); // array of array of connections.

      var nodeList = [];
      var binaryNodeList = R.zeros(nNodes);

      for (i=0;i<nNodes;i++) {
        nodeConnections[i] = []; // empty array.
      }

      for (i=0;i<nConnections;i++) {
        if (this.unrolledConnections[i][IDX_CONNECTION] && this.unrolledConnections[i][IDX_ACTIVE]) {
          nodeConnections[connections[i][1]].push(i); // push index of connection to output node
          binaryNodeList[connections[i][0]] = 1;
          binaryNodeList[connections[i][1]] = 1;
        }
      }

      for (i=0;i<nNodes;i++) {
        if (binaryNodeList[i] === 1) {
          nodeList.push(i);
        }
      }

      for (i=0,n=inputNodeList.length;i<n;i++) {
        touched[inputNodeList[i]] = 1.0;
      }

      function allTouched(listOfNodes) {
        for (var i=0,n=listOfNodes.length;i<n;i++) {
          if (touched[listOfNodes[i]] !== 1) {
            return false;
          }
        }
        return true;
      }

      function forwardTouch() {
        var i, j;
        var n=nNodes, m, ix; // ix is the index of the global connections.
        var theNode;

        for (i=0;i<n;i++) {
          if (touched[i] === 0) {
            theNode = nodeConnections[i];
            for (j=0,m=theNode.length;j<m;j++) {
              ix = theNode[j];
              if (touched[connections[ix][0]] === 1) {
                //console.log('node '+connections[ix][0]+' is touched, so now node '+i+' has been touched');
                touched[i] = 2; // temp touch state
                break;
              }
            }
          }
        }

        for (i=0;i<n;i++) {
          if (touched[i] === 2) touched[i] = 1;
        }

      }

      // forward tick magic
      function forwardTick(model) {
        var i, j;
        var n, m, cIndex, nIndex; // ix is the index of the global connections.
        var theNode;

        var currNode, currOperand, currConnection; // recurrent js objects
        var needOperation; // don't need operation if node is operator(node) is null or mul or add
        var nodeType;
        var finOp; // operator after all operands are weighted summed or multiplied
        var op; // either 'add' or 'eltmult'
        var out; // temp variable for storing recurrentjs state
        var cumulate; // cumulate all the outs (either addition or mult)

        n=nNodes;
        for (i=0;i<n;i++) {
          if (touched[i] === 1) { // operate on this node since it has been touched

            theNode = nodeConnections[i];
            m=theNode.length;
            // if there are no operands for this node, then don't do anything.
            if (m === 0) continue;

            nodeType = nodes[i];
            needOperation = true;
            finOp = operators[nodeType];
            if (finOp === null || finOp === 'mult' || finOp === 'add' || nodeType === NODE_MGAUSSIAN) needOperation = false;

            // usually we add weighted sum of operands, except if operator is mult
            op = 'add';
            if (finOp === 'mult') op = 'eltmul';

            // cumulate all the operands
            for (j=0;j<m;j++) {
              cIndex = theNode[j];
              nIndex = connections[cIndex][0];
              currConnection = model.connections[cIndex];
              currOperand = model.nodes[nIndex];
              out = G.mul(currOperand, currConnection);
              if (nodeType === NODE_MGAUSSIAN) { // special case:  the nasty multi gaussian
                out = G.gaussian(out);
              }
              if (j === 0) { // assign first result to cumulate
                cumulate = out;
              } else { // cumulate next result after first operand
                cumulate = G[op](cumulate, out); // op is either add or eltmul
              }
            }

            // set the recurrentjs node here
            model.nodes[i] = cumulate;
            // operate on cumulated sum or product if needed
            if (needOperation) {
              model.nodes[i] = G[finOp](model.nodes[i]);
            }

            // another special case, squaring the output
            if (nodeType === NODE_SQUARE) {
              model.nodes[i] = G.eltmul(model.nodes[i], model.nodes[i]);
            }

          }
        }


      }

      function printTouched() {
        var i;
        var result="";
        for (i=0;i<touched.length;i++) {
          result += touched[i]+" ";
        }
        console.log(result);
      }

      //printTouched();
      for (i=0;i<MAX_TICK;i++) {
        forwardTouch();
        forwardTick(this.model); // forward tick the network using graph
        //printTouched();
        /*
        if (allTouched(outputNodeList)) {
          //console.log('all outputs touched!');
          //break;
        }
        */
        if (allTouched(nodeList)) {
          //console.log('all nodes touched!');
          break;
        }
      }

    }

  };

  global.init = init;
  global.Genome = Genome;
  global.getNodes = getNodes;
  global.getConnections = getConnections;
  global.randomizeRenderMode = randomizeRenderMode;
  global.setRenderMode = setRenderMode;
  global.getRenderMode = getRenderMode;
  global.getNumInput = function() { return nInput; };
  global.getNumOutput = function() { return nOutput; };


})(N);
(function(lib) {
  "use strict";
  if (typeof module === "undefined" || typeof module.exports === "undefined") {
    window.jsfeat = lib; // in ordinary browser attach library to window
  } else {
    module.exports = lib; // in nodejs
  }
})(N);

/*
N.init({nInput: 2, nOutput: 3});

var genome = new N.Genome();
var genome1 = new N.Genome();
var genome2 = new N.Genome();

for (var i=0;i<2;i++) {
  genome.addRandomNode();
  genome.addRandomConnection();
  genome.addRandomConnection();
  genome.addRandomConnection();
  genome1.addRandomNode();
  genome1.addRandomConnection();
  genome1.addRandomConnection();
  genome1.addRandomConnection();
  genome2.addRandomNode();
  genome1.addRandomConnection();
  genome1.addRandomConnection();
  genome1.addRandomConnection();
}


var child = genome.crossover(genome1);
var child2 = child.crossover(genome2);

//genome = child.crossover(child2);

//console.log(genome);

var input = [[-0.5, -0.5]]; //, [0.25, 0.75], [-0.25, 0.5], [0.6, -0.6]];

genome.setupModel(input.length);
genome.setInput(input);

var G = new R.Graph();

genome.forward(G);

var output = genome.getOutput();


var i, j;
for (i=0;i<3;i++) {
  for (j=0;j<1;j++) {
    output[i].dw[j] = -Math.random();
  }
}


console.log(output);
console.log(genome.model);
console.log('-----------');

G.backward();

console.log(output);
console.log(genome.model);

*/

