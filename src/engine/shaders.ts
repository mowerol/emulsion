// SPDX-License-Identifier: GPL-3.0-or-later
import { assemble } from './glsl';

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
import toneequalizer from './shaders/stages/toneequalizer.glsl?raw';
import toneeqmask from './shaders/toneeqmask.frag.glsl?raw';
import sample from './shaders/sample.frag.glsl?raw';
import lens from './shaders/stages/lens.glsl?raw';
import optics from './shaders/stages/optics.glsl?raw';
import emulsion from './shaders/stages/emulsion.glsl?raw';
import output from './shaders/stages/output.glsl?raw';
import grain from './shaders/stages/grain.glsl?raw';
import scanner from './shaders/stages/scanner.glsl?raw';
import finish from './shaders/stages/finish.glsl?raw';
import curve from './shaders/stages/curve.glsl?raw';

export const SHADER_FILES: Record<string, string> = {
  'common.glsl': common,
  'stages/tone.glsl': tone,
  'stages/input.glsl': input,
  'stages/exposure.glsl': exposure,
  'stages/colorbalance.glsl': colorbalance,
  'stages/toneequalizer.glsl': toneequalizer,
  'stages/lens.glsl': lens,
  'stages/optics.glsl': optics,
  'stages/emulsion.glsl': emulsion,
  'stages/output.glsl': output,
  'stages/grain.glsl': grain,
  'stages/scanner.glsl': scanner,
  'stages/finish.glsl': finish,
  'stages/curve.glsl': curve,
};

export const SHADERS = {
  vertex: quadVert,
  develop: assemble(develop, SHADER_FILES),
  extract: assemble(extract, SHADER_FILES),
  toneeqmask: assemble(toneeqmask, SHADER_FILES),
  sample: assemble(sample, SHADER_FILES),
  blur,
  down,
};
