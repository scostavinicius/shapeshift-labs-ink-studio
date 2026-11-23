#include "signalsmith-stretch.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <vector>

int main() {
  constexpr int rate = 48000, inputFrames = 48000, outputFrames = 72000;
  constexpr double tau = 6.283185307179586;
  std::vector<float> left(inputFrames), right(inputFrames), outL(outputFrames), outR(outputFrames);
  for (int i=0; i<inputFrames; ++i) {
    const auto fade = std::min({1.0, i/800.0, (inputFrames-1-i)/800.0});
    const auto attack = i==4000 || i==32000 ? 0.13 : 0.0;
    left[i] = static_cast<float>(fade*(.19*std::sin(tau*220*i/rate)+attack));
    right[i] = static_cast<float>(fade*(.16*std::sin(tau*330*i/rate)+attack));
  }
  signalsmith::stretch::SignalsmithStretch<float> stretch(89);
  stretch.presetDefault(2, rate);
  stretch.setTransposeSemitones(7);
  const float *in[] = {left.data(), right.data()};
  float *out[] = {outL.data(), outR.data()};
  if (!stretch.exact(in, inputFrames, out, outputFrames)) return 1;
  double dominant=0, power=0;
  for (int hz=285; hz<=375; ++hz) {
    double re=0, im=0;
    for (int i=16000; i<56000; ++i) {
      if (!std::isfinite(outL[i]) || !std::isfinite(outR[i])) return 2;
      const auto phase=tau*hz*i/rate;
      re+=outL[i]*std::cos(phase);
      im+=outL[i]*std::sin(phase);
    }
    const auto size=re*re+im*im;
    if (size>power) {power=size;dominant=hz;}
  }
  std::cout << "{\"inputFrames\":" << inputFrames << ",\"outputFrames\":" << outputFrames
    << ",\"inputLatency\":" << stretch.inputLatency() << ",\"outputLatency\":" << stretch.outputLatency()
    << ",\"leftDominantHz\":" << dominant << "}\n";
  return std::abs(dominant-220*std::pow(2.0,7.0/12))<2 ? 0 : 3;
}
