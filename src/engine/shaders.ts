// SPDX-License-Identifier: GPL-3.0-or-later
import { assemble } from './glsl';

import dcp from './shaders/stages/dcp.glsl?raw';
import dcpPass from './shaders/dcp.frag.glsl?raw';
import quadVert from './shaders/quad.vert.glsl?raw';
import common from './shaders/common.glsl?raw';
import develop from './shaders/develop.frag.glsl?raw';
import extract from './shaders/extract.frag.glsl?raw';
import blur from './shaders/blur.frag.glsl?raw';
import down from './shaders/down.frag.glsl?raw';
import tone from './shaders/stages/tone.glsl?raw';
import input from './shaders/stages/input.glsl?raw';
import exposure from './shaders/stages/exposure.glsl?raw';
import colorbalance from './shaders/stages/colorbalance.glsl?raw';
import masks from './shaders/stages/masks.glsl?raw';
import brushVert from './shaders/brush.vert.glsl?raw';
import brushFrag from './shaders/brush.frag.glsl?raw';
import toneequalizer from './shaders/stages/toneequalizer.glsl?raw';
import toneeqmask from './shaders/toneeqmask.frag.glsl?raw';
import sample from './shaders/sample.frag.glsl?raw';
import lenscorrect from './shaders/lenscorrect.frag.glsl?raw';
import lens from './shaders/stages/lens.glsl?raw';
import optics from './shaders/stages/optics.glsl?raw';
import output from './shaders/stages/output.glsl?raw';
import grain from './shaders/stages/grain.glsl?raw';
import scanner from './shaders/stages/scanner.glsl?raw';
import finish from './shaders/stages/finish.glsl?raw';
import curve from './shaders/stages/curve.glsl?raw';
import clarity from './shaders/stages/clarity.glsl?raw';
import dehaze from './shaders/stages/dehaze.glsl?raw';
import dehazePass from './shaders/dehaze.frag.glsl?raw';
import lab from './shaders/stages/lab.glsl?raw';
import texture from './shaders/stages/texture.glsl?raw';
import usmStage from './shaders/stages/usm.glsl?raw';
import usm from './shaders/usm.frag.glsl?raw';
import colorequal from './shaders/stages/colorequal.glsl?raw';
import lut from './shaders/stages/lut.glsl?raw';
import ce from './shaders/ce.frag.glsl?raw';
import maskrefine from './shaders/maskrefine.frag.glsl?raw';
import eq from './shaders/eq.frag.glsl?raw';
import cs from './shaders/cs.frag.glsl?raw';
import llcurve from './shaders/llcurve.frag.glsl?raw';
import llreduce from './shaders/llreduce.frag.glsl?raw';
import llcollapse from './shaders/llcollapse.frag.glsl?raw';

export const SHADER_FILES: Record<string, string> = {
  'stages/dcp.glsl': dcp,
  'common.glsl': common,
  'lenscorrect.frag.glsl': lenscorrect,
  'stages/tone.glsl': tone,
  'stages/input.glsl': input,
  'stages/exposure.glsl': exposure,
  'stages/colorbalance.glsl': colorbalance,
  'stages/masks.glsl': masks,
  'stages/toneequalizer.glsl': toneequalizer,
  'stages/lens.glsl': lens,
  'stages/optics.glsl': optics,
  'stages/output.glsl': output,
  'stages/grain.glsl': grain,
  'stages/scanner.glsl': scanner,
  'stages/finish.glsl': finish,
  'stages/curve.glsl': curve,
  'stages/clarity.glsl': clarity,
  'stages/dehaze.glsl': dehaze,
  'stages/lab.glsl': lab,
  'stages/texture.glsl': texture,
  'stages/usm.glsl': usmStage,
  'stages/colorequal.glsl': colorequal,
  'stages/lut.glsl': lut,
};

export const SHADERS = {
  dcp: assemble(dcpPass, SHADER_FILES),
  vertex: quadVert,
  lenscorrect: assemble(lenscorrect, SHADER_FILES),
  develop: assemble(develop, SHADER_FILES),
  dehaze: assemble(dehazePass, SHADER_FILES),
  extract: assemble(extract, SHADER_FILES),
  toneeqmask: assemble(toneeqmask, SHADER_FILES),
  sample: assemble(sample, SHADER_FILES),
  blur,
  down,
  llcurve,
  llreduce,
  llcollapse,
  eq,
  cs,
  usm,
  ce: assemble(ce, SHADER_FILES),
  maskrefine: assemble(maskrefine, SHADER_FILES),
  brushVert,
  brushFrag,
};
