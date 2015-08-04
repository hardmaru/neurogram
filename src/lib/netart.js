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

// neural network random art generator
if (typeof module != "undefined") {
  var R = require('./recurrent.js');
  var convnetjs = require('./convnet.js');
  var N = require('./neat.js');
}

var NetArt = {};
(function(global) {
  "use strict";

  // settings of nnet:
  var networkSize = 16*1.0;
  var nHidden = 8*1.0;
  var nOut = 3; // r, g, b layers

  var G0 = new R.Graph(false);

  // internal image class
  var Image = function(n_, d_) {
    this.n = n_ || 32; // maxrow
    this.d = d_ || 32; // maxcol
    var l = this.n*this.d;
    this.r = R.zeros(l); // between 0 -> 1
    this.g = R.zeros(l);
    this.b = R.zeros(l);
    this.label = -1;
  };

  Image.prototype = {
    checkBound: function(i, j) {
      // returns true if (i, j) within boundary of image
      if (i >= 0 && j >= 0 && i < this.n && j < this.d) {
        return true;
      }
      return false;
    },
    get: function(vec, row, col) {
      // returns pixel at (row, col) of 1d unrolled vector vec
      return vec[row*this.n+col];
    },
    set: function(vec, row, col, value) {
      // sets (row, col) to value for a 1d unrolled vec
      vec[row*this.n+col] = value;
    },
    getColor: function(row, col) {
      // returns pixel at (row, col) of 1d unrolled vector vec
      return [this.r[row*this.n+col], this.g[row*this.n+col], this.b[row*this.n+col]];
    },
    setColor: function(row, col, c) {
      // sets (row, col) to value for a 1d unrolled vec
      this.r[row*this.n+col] = c[0];
      this.g[row*this.n+col] = c[1];
      this.b[row*this.n+col] = c[2];
    },
    copy: function() {
      // returns exact copy of image
      var image = new Image(this.n, this.d);
      image.r = R.copy(this.r);
      image.g = R.copy(this.g);
      image.b = R.copy(this.b);
      image.label = this.label;
      return image;
    },
    flip: function() {
      // return a copy of the horizontally flipped image
      var image = this.copy();
      var tempColor;
      var middle = Math.floor(this.d/2);
      var maxcol = this.d;
      for (var i=0,maxrow=this.n;i<maxrow;i++) {
        for (var j=0;j<middle;j++) {
          tempColor = image.getColor(i, j);
          image.setColor(i, j, image.getColor(i, maxcol-j-1));
          image.setColor(i, maxcol-j-1, tempColor);
        }
      }
      return image;
    },
    augment: function(drow, dcol, flip_) {
      // return a copy of the augmented image.
      var flip = typeof flip_ === 'undefined' ? false : flip_;
      var image = this.copy();
      for (var i=0,maxrow=this.n;i<maxrow;i++) {
        for (var j=0,maxcol=this.d;j<maxcol;j++) {
          if (this.checkBound(i-drow,j-dcol)) {
            image.setColor(i, j, this.getColor(i-drow,j-dcol));
          }
        }
      }
      if (flip) {
        image = image.flip();
      }
      return image;
    },
    randomAugment: function(shiftSize) {
      // returns a randomised augmented version of the image with 50% prob flip
      return this.augment(R.randi(-shiftSize,shiftSize),R.randi(-shiftSize,shiftSize),(Math.random()<0.5));
    },
    getConvnetVol: function() {
      // return an object compatible with the input into a convnet.js network
      var maxrow = this.n;
      var maxcol = this.d;
      var x = new convnetjs.Vol(maxrow,maxcol,3,0.0);

      var i, j;
      var c;

      for( i=0;i<maxcol;i++) {
        for( j=0;j<maxrow;j++) {
          c = this.getColor(i, j);
          x.set(j,i,0,c[0]-0.5);
          x.set(j,i,1,c[1]-0.5);
          x.set(j,i,2,c[2]-0.5);
        }
      }

      return x;
    },
    getCanvasImage: function (ctx) { // input is a NetArt.Image

      var sizeh = this.d;
      var sizew = this.n;
      var imgData=ctx.createImageData(sizeh, sizew);

      var k = 0;
      var i, j;
      var offset;

      for (i = 0; i < sizeh; i++) {
        for (j = 0; j < sizew; j++) {
          offset = i*sizew;
          imgData.data[k+0]=this.r[offset+j]*255.0;
          imgData.data[k+1]=this.g[offset+j]*255.0;
          imgData.data[k+2]=this.b[offset+j]*255.0;
          imgData.data[k+3]=255;
          k+=4;
        }
      }
      return imgData;
    }

  };

  var createModel = function() {
    // returns a recurrent.js model used to generate images

    var model = [];
    var i;

    var randomSize = 1.0;

    // define the model below:
    model.w_in = R.RandMat(networkSize, 3, 0, randomSize); // x, y, and bias

    for (i = 0; i < nHidden; i++) {
      model['w_'+i] = R.RandMat(networkSize, networkSize, 0, randomSize);
    }

    model.w_out = R.RandMat(nOut, networkSize, 0, randomSize); // output layer

    return model;
  };

  var forwardNetwork = function(model, x_, y_, graph_) {
    // x_, y_ is a normal javascript float, will be converted to a mat object below
    // can pass in graph object if one needs backprop later.
    var x = new R.Mat(3, 1); // input
    var i;
    x.set(0, 0, x_);
    x.set(1, 0, y_);
    x.set(2, 0, 1.0); // bias.
    var out;
    var G = typeof graph_ === 'undefined'? G0 : graph_;
    out = G.tanh(G.mul(model.w_in, x));
    for (i = 0; i < nHidden; i++) {
      if (i % 3 === 0) {
        out = G.tanh(G.mul(model['w_'+i], out));
      } else {
        out = G.tanh(G.mul(model['w_'+i], out));
      }
    }
    out = G.sigmoid(G.mul(model.w_out, out));
    return out;
  };

  function getColorAt(model, x, y) {
    // function that returns a color given coordintes (x, y)
    // (x, y) are scaled to -0.5 -> 0.5 for image recognition later
    // but it can be behond the +/- 0.5 for generation above and beyond
    // recognition limits
    var r, g, b;
    var out = forwardNetwork(model, x, y);

    r = out.w[0];
    g = out.w[1];
    b = out.w[2];

    return [r, g, b];
  }

  // from
  // https://bgrins.github.io/TinyColor/docs/tinycolor.html
  function hsvToRgb(h, s, v) {
      // hsv are between 0 and 1
      // returns rgb between 0 and 1

      h *= 6;

      var i = Math.floor(h),
          f = h - i,
          p = v * (1 - s),
          q = v * (1 - f * s),
          t = v * (1 - (1 - f) * s),
          mod = i % 6,
          r = [v, q, p, p, t, v][mod],
          g = [t, v, v, q, p, p][mod],
          b = [p, p, t, v, v, q][mod];

      return [r, g, b];
  }

  function genGenomeImage(genome, sizeh, sizew) {
    // returns a NetArt.Image of this genome given some size params

    var i, j, k;
    var inputDepth = sizew; // sizeh*sizew; // try 1-d line
    var img = new Image(sizeh, sizew);
    var input = new R.Mat(inputDepth, 3); // x, y, distance from center
    var output;
    var scale = 24;
    var factor = Math.min(sizeh, sizew)/scale;
    var offset;
    var counter;
    var x, y;

    var r, g, b;

    var renderMode = N.getRenderMode();

    var G = new R.Graph(false);

    // setup model
    genome.setupModel(inputDepth);

    for (i = 0; i < sizeh; i++) { // try one line at a time to save memory.

      // populate input vector with (x, y) inputs

      for (j = 0; j < sizew; j++) {
        x = i/factor-0.5*scale;
        y = j/factor-0.5*scale;
        input.set(j, 0, x);
        input.set(j, 1, y);
        input.set(j, 2, Math.sqrt((x*x+y*y)));
      }

      // setup inputs
      genome.setInput(input);
      genome.forward(G);
      output = genome.getOutput();

      // put thru 2 more layers, tanh, and abs, so all values between 0 and 1.
      for (k=0;k<3;k++) {

        if (renderMode === 0) {
          output[k] = G.sigmoid(output[k]);
        } else if (renderMode === 1) {
          output[k] = G.gaussian(output[k]);
        } else {
          output[k] = G.tanh(output[k]);
          output[k] = G.abs(output[k]);
        }

      }

      // construct the image back from outputs
      offset = i*sizew;
      for (j = 0; j < sizew; j++) {

        r = output[0].w[j];
        g = output[1].w[j];
        b = output[2].w[j];
        img.r[offset+j]=r;
        img.g[offset+j]=g;
        img.b[offset+j]=b;

      }

      genome.zeroOutNodes(); // wipe out previous values.

    }

    return img;

  }

  function genImage(model, sizeh, sizew) {

    var img = new Image(sizeh, sizew);
    var offset;
    var i, j;
    var factor = Math.min(sizeh, sizew);
    var c;

    for (i = 0; i < sizeh; i++) {
      for (j = 0; j < sizew; j++) {
        offset = i*sizew;
        c = getColorAt(model, i/factor-0.5,j/factor-0.5);
        img.r[offset+j]=c[0];
        img.g[offset+j]=c[1];
        img.b[offset+j]=c[2];
      }
    }

    return img;

  }

  function backPropImage(model, sizeh, sizew, input) {
    // input is previous input of image.

    var img = new Image(sizeh, sizew);
    var offset;
    var i, j;
    var factor = Math.min(sizeh, sizew);
    var out;
    var x, y;
    var graph;

    for (i = 0; i < sizeh; i++) {
      for (j = 0; j < sizew; j++) {
        offset = i*sizew;
        x = i/factor-0.5;
        y = j/factor-0.5;
        graph = new R.Graph();
        out = forwardNetwork(model, x, y, graph);
        img.r[offset+j]=out.w[0];
        img.g[offset+j]=out.w[1];
        img.b[offset+j]=out.w[2];
        out.dw[0] = input.get_grad(j, i, 0);
        out.dw[1] = input.get_grad(j, i, 1);
        out.dw[2] = input.get_grad(j, i, 2);
        graph.backward();
      }
    }

    return img;

  }

  // evolve artwork to adapt to discriminiate network
  function evolveAdaptiveModel(net, desiredFitness_, maxAttempt_) {
    var model = createModel();
    var img;
    var imgData;
    var desiredFitness = desiredFitness_ || 0.7;
    var maxAttempt = maxAttempt_ || 5;
    var target = 1;

    // neuroevolution stuff:
    var trainer_settings = {
          population_size: 45,
          hall_of_fame_size: 5,
          mutation_size: 0.1,
          mutation_rate: 0.6,
          init_weight_magnitude: 1.0,
          elite_percentage: 0.30,
          debug_mode: false
        };

    var trainer = new R.GATrainer(model, trainer_settings);

    var predict = function(x) {
      // see predictions here
      var output = net.forward(x);
      return output.w;
    };

    function fitFunc(model) {
      var img = genImage(model, 32, 32);
      var pred = predict(img.getConvnetVol());
      return pred[target];
    }

    function evolve() {
      var i;
      var n = trainer.length;
      for (i=0;i<n;i++) {
        trainer.pushGeneToModel(model, i);
        trainer.genes[i].fitness = fitFunc(model);
      }
      trainer.sortGenes();
    }

    // page request:
    function update() {
      evolve();
      var bestFitness = trainer.genes[0].fitness;
      if (trainer.debug_mode) {
        console.log('bestFitness = '+bestFitness);
      }
      trainer.pushGeneToModel(model, 0);
      trainer.evolve(); // mutation
      return bestFitness;
    }

    var fitness = -1e24;
    for (var i = 0; i < maxAttempt; i++) {
      fitness = update();
      if (fitness > desiredFitness) {
        break;
      }
    }
    console.log('evolved fitness = '+fitness);
    return model;

  }

  // create artwork that passes a trained discriminative network
  function createAdaptiveModel(net, initModel_, desiredFitness_, maxAttempt_) {
    // hold image variables outside of loop.
    // init:
    var model = initModel_ || createModel();
    var img;
    var solver = new R.Solver(); // the Solver uses RMSProp
    var learnRate = 0.001;
    var imgData;
    var desiredFitness = desiredFitness_ || 0.65;
    var maxAttempt = maxAttempt_ || 200;
    var target = 1;
    var fitness = 0;
    var input, output;
    var cost_loss;

/* debug
      img = genImage(model, 32, 32); // forward prop to generate image
      input = img.getConvnetVol(); // convert image to convnet.js vol
      output = net.forward(input, false); // forward prop to get classification
      fitness = output.w[target]; // see the probability of image fooling network
      console.log('initial fitness = '+fitness);
*/
    // each step in the optimisation before gradient descent

    for (var i = 0; i < maxAttempt; i++) {

      img = genImage(model, 32, 32); // forward prop to generate image
      input = img.getConvnetVol(); // convert image to convnet.js vol
      output = net.forward(input, false); // forward prop to get classification

      fitness = output.w[target]; // see the probability of image fooling network

      if (i % 10 === 0) {
        console.log('fitness #'+(i+1)+' = '+fitness);
      }

      if (fitness > desiredFitness) { // found solution, return img and quit.
        console.log((i+0)+' attempts made');
        return model;
      }

      cost_loss = net.backward(target); // backprop to get dClass / dPixel
      img = backPropImage(model, 32, 32, input); // backprop to get dClass/dWeight
      solver.step(model, R.randf(learnRate, 1*learnRate), 1e-8, 5.0);

    }

    console.log('cannot generate image after '+maxAttempt+' attempts');
    return null; // target not achieved, return null.

  }


  // exports:

  global.Image = Image;
  global.genGenomeImage = genGenomeImage;
  global.createModel = createModel;
  global.createAdaptiveModel = createAdaptiveModel;
  global.evolveAdaptiveModel = evolveAdaptiveModel;
  global.genImage = genImage;
  global.backPropImage = backPropImage;


})(NetArt);
(function(lib) {
  "use strict";
  if (typeof module === "undefined" || typeof module.exports === "undefined") {
    window.jsfeat = lib; // in ordinary browser attach library to window
  } else {
    module.exports = lib; // in nodejs
  }
})(NetArt);
