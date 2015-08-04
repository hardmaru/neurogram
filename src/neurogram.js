
/*globals paper, console, $ */
/*jslint nomen: true, undef: true, sloppy: true */

// neurogram: picbreeder clone written in js.

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

var neurogram = {};
(function(global) {
  "use strict";

  // constants that control the app:

  var nRow = 5;
  var nCol = 5;
  var nImage = nRow * nCol;
  var thumbSize = 90; // actually 96, but for borders
  var fullThumbSize = thumbSize+2;

  if (!desktopMode) {
    thumbSize = 55;
    fullThumbSize = thumbSize+2;
  }

  document.getElementById('imagePlane').width = nCol*fullThumbSize+2;
  document.getElementById('imagePlane').height = nRow*fullThumbSize+2;

  var maxSelected = 4; // we can only evolve max of 4 genomes

  var genome = []; // 2d array of genomes
  var thumb = []; // 2d array of images

  var currSelected = 0;
  var lastSelected = -1;
  var selectionList = [];

  // second plane
  var chosenGenome;
  var bigimg;
  var bigThumbSize = 320;
  if (!desktopMode) {
    bigThumbSize = 150;
  }

  document.getElementById('selectedPlane').width = bigThumbSize;
  document.getElementById('selectedPlane').height = bigThumbSize;

  var canvas = document.getElementById('imagePlane');
  var ctx = canvas.getContext('2d');

  // large selected
  var canvas2 = document.getElementById('selectedPlane');
  var ctx2 = canvas2.getContext('2d');

  var colaGraph;

  function clearSelection() {
    // http://stackoverflow.com/questions/3169786/clear-text-selection-with-javascript
    var selection = ('getSelection' in window) ? window.getSelection() : ('selection' in document) ? document.selection : null;
    if ('removeAllRanges' in selection) selection.removeAllRanges();
    else if ('empty' in selection) selection.empty();
  }

  function getPicLoc(n) {
    var i, j;
    i = Math.floor(n/nRow);
    j = n % nCol;
    return [i, j];
  }

  // initialise NEAT library (set number of inputs and outputs
  N.init({nInput: 3, nOutput: 3});

  // initializes random genomes at the beginning
  function initAll() {
    var i, j;
    genome = [];
    thumb = [];
    lastSelected = -1;
    for (i=0;i<nRow;i++) {
      genome.push([]);
      thumb.push([]);
      for (j=0;j<nCol;j++) {
        genome[i].push(null);
        thumb[i].push(null);
      }
    }
  }

  function getWidth() {
    return $(window).width();
  }

  function getHeight() {
    return $(window).height();
  }

  function initGenome() {

    N.randomizeRenderMode();

    var i, j, k, m, n, m1, n1, m2, n2;
    for (i=0;i<nRow;i++) {
      for (j=0;j<nCol;j++) {
        genome[i][j] = new N.Genome();
      }
    }

    for (k=0;k<8;k++) {
      for (i=0;i<nRow;i++) {
        for (j=0;j<nCol;j++) {
          if (Math.random() < 0.5) genome[i][j].addRandomNode();
          if (Math.random() < 0.5) genome[i][j].addRandomConnection();
        }
      }

    }

  }

  // initialises all the images (must be run after genome array is populated)
  function initThumb() {
    var i, j;
    for (i=0;i<nRow;i++) {
      for (j=0;j<nCol;j++) {
        genome[i][j].roundWeights();
        thumb[i][j] = NetArt.genGenomeImage(genome[i][j], thumbSize, thumbSize);
      }
    }
  }

  function maskThumb(i, j) {
    ctx.fillStyle="rgba(255, 255, 255, 0.7)";
    ctx.fillRect(fullThumbSize*j+2, fullThumbSize*i+2, thumbSize, thumbSize);
  }

  function drawThumb(i, j) {
    ctx.putImageData(thumb[i][j].getCanvasImage(ctx), fullThumbSize*j+2, fullThumbSize*i+2);
  }

  function drawAllThumb() {
    var i, j;
    ctx.clearRect(0,0,fullThumbSize*5+2,fullThumbSize*5+2);
    for (i=0;i<nRow;i++) {
      for (j=0;j<nCol;j++) {
        drawThumb(i, j);
      }
    }
  }

  function outlineThumb(n, c, width) {
    // draws a box of color c around pic n
    ctx.beginPath();
    ctx.lineWidth=width || "2";
    ctx.strokeStyle=c;
    var loc = getPicLoc(n);
    var i = loc[0];
    var j = loc[1];
    ctx.rect(j*fullThumbSize+1,i*fullThumbSize+1,fullThumbSize,fullThumbSize);
    ctx.stroke();
  }

  function updateSelected() {
    // clear old circle
    var i;
    for (i=0;i<nImage;i++) {
      outlineThumb(i, "#FFF");
    }

    for (i=0;i<selectionList.length;i++) {
      outlineThumb(selectionList[i], "rgba(255,0,0, 1.0)");
    }

    // draw new selected
    if (currSelected >= 0) outlineThumb(currSelected, "rgba(0, 255, 0, 1.0)");
  }

  function drawBigImg(chosen) {
    bigimg = NetArt.genGenomeImage(chosen, bigThumbSize/1, bigThumbSize/1);
    ctx2.clearRect(0,0,bigThumbSize/1,bigThumbSize/1);
    ctx2.putImageData(bigimg.getCanvasImage(ctx), 0, 0);
    ctx2.scale(1, 1);
    ctx2.drawImage(canvas2, 0, 0);
  }

  function initSecondScreen(selection) {
    var loc = getPicLoc(selection);
    var i, j;
    i = loc[0];
    j = loc[1];

    $(".col-fixed-640").css("width", bigThumbSize*2+"px");

    chosenGenome = genome[i][j].copy();
    chosenGenome.roundWeights();

    drawBigImg(chosenGenome);

    if (desktopMode) {
      // put below code here to ignore graph for mobiles.
    }

    var rect2 = canvas2.getBoundingClientRect();
    $("#drawGraph").css({
        "position": "absolute",
        "top": Math.max(rect2.top, 20) + "px",
        "left": Math.max(getWidth()/2+10,(desktopMode? 360: 160)) + "px",
        });

    colaGraph = RenderGraph.getGenomeGraph(chosenGenome);
    RenderGraph.drawGraph(colaGraph);

  }

  $("#secondScreen").hide();
  $("#mainScreen").hide();

  //if (!desktopMode) {
  //  $("#drawGraphLoaded").hide();
  //  $("#drawGraph").hide();
  //}

  $("#imagePlane").mousemove(function( event ) {
    var rect = canvas.getBoundingClientRect();
    var x = (event.pageX - rect.left - 1);
    var y = (event.pageY - rect.top - 1);
    if (x < 0 || y < 0) return;
    var j = Math.floor(x/fullThumbSize);
    var i = Math.floor(y/fullThumbSize);
    //console.log('x, y = '+x+","+y+'\ti, j = '+i+","+j);
    var selected = i*nRow+j;
    if (selected >= nImage) return;
    if (selected !== currSelected) {
      currSelected = selected;
      updateSelected();
    }
  });
  $("#imagePlane").mouseout(function( event ) {
    currSelected = -1;
    updateSelected();
  });

  $("#imagePlane").click(function(){
    $("#origPicBreederLink").hide();
    var ix = selectionList.indexOf(currSelected);
    lastSelected = currSelected;
    if (ix === -1) {
      while (selectionList.length >= maxSelected) {
        selectionList.shift();
      }
      selectionList.push(currSelected);
    } else {
      selectionList.splice(ix, 1);
    }
    updateSelected();

  });


  $("#startover_button").click(function(){
    console.log('starting over...');
    initAll();
    initGenome();
    initThumb();
    drawAllThumb();
  });


  $("#evolve_button").click(function(){
    var len = selectionList.length;
    if (len === 0) return;
    var mom, dad;
    var momGene, dadGene;
    var loc;
    var k, i, j;
    var g;
    var preserveList = R.zeros(nImage);

    for (i=0;i<len;i++) {
      preserveList[selectionList[i]] = 1;
    }

    function getThing(thing, k) {
      var i, j;
      var loc;
      loc = getPicLoc(k);
      i = loc[0];
      j = loc[1];
      return thing[i][j];
    }

    // mutate and evolve!
    for (k=0;k<nImage;k++) {
      if (preserveList[k] === 0) {
        loc = getPicLoc(k);
        i = loc[0];
        j = loc[1];
        mom = selectionList[R.randi(0, len)];
        dad = selectionList[R.randi(0, len)];
        momGene = getThing(genome, mom);
        dadGene = getThing(genome, dad);


        if (mom === dad) {
          genome[i][j] = momGene.copy();
        } else {
          genome[i][j] = momGene.crossover(dadGene);
        }

        genome[i][j].mutateWeights();
        if (Math.random() < 0.5) genome[i][j].addRandomNode();
        if (Math.random() < 0.5) {
          genome[i][j].addRandomConnection();
        }

        genome[i][j].roundWeights();
        thumb[i][j] = NetArt.genGenomeImage(genome[i][j], thumbSize, thumbSize);
        drawThumb(i, j);
      }
    }

    // clear selection list
    selectionList = [];

    // redraw selection boxes
    updateSelected();

  });

  function startSecondScreen() {
    $("#origPicBreederLink").hide();
    clearSelection();
    if (currSelected < 0) return;
    $("#mainScreen").hide();
    $("#secondScreen").show();
    $("#publish_button").show();
    initSecondScreen(currSelected);
  }

  if (desktopMode) {
    $("#imagePlane").dblclick(function(){
      startSecondScreen();
    });
  }

  $("#zoom_selected_button").click(function(){
    console.log(lastSelected);
    if (lastSelected < 0) return;
    currSelected = lastSelected;
    startSecondScreen();
  });
  if (desktopMode) {
    $("#zoom_selected_button").hide();
  }


  function mainScreen() {
    clearSelection();
    RenderGraph.removeSVG();
    $("#secondScreenWarning").text("");
    $("#neurogram_description").val("");
    $("#secondScreen").hide();
    $("#galleryScreen").hide();
    $("#loadScreen").hide();
    $("#mainScreen").show();
  }

  $("#back_button").click(function(){
    mainScreen();
  });

  $("#secondScreenWarning").css({
      "color": "#EE5C44"
      });

  $("#save_png_button").click(function(){
    var fileName = "neurogram.png";

    $("#secondScreenWarning").text("saved as '"+fileName+"'.");
    document.getElementById("save_png_button").download = fileName;
    document.getElementById("save_png_button").href = canvas2.toDataURL("image/png").replace(/^data:image\/[^;]/, 'data:application/octet-stream');
  });


  function main() {
    // start of the program

      initAll();
      initGenome();
      initThumb();
      drawAllThumb();
      $("#mainScreen").show();

  }

  global.main = main;

})(neurogram);
(function(lib) {
  "use strict";
  if (typeof module === "undefined" || typeof module.exports === "undefined") {
    window.jsfeat = lib; // in ordinary browser attach library to window
  } else {
    module.exports = lib; // in nodejs
  }
})(neurogram);



