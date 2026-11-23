/* Optional offline comparison against native instrument shaping. Input and output are mono f32le. */
#include "signalsmith-stretch.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <vector>

int main(int argc, char **argv) {
  if (argc != 10) return 1;
  const int rate=std::stoi(argv[3]), frames=std::stoi(argv[4]), attack=std::stoi(argv[5]), join=std::stoi(argv[6]);
  const float pitch=std::stof(argv[7]), formant=std::stof(argv[8]), root=std::stof(argv[9]);
  std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
  const auto bytes=input.tellg();
  if (!input || bytes<=0 || bytes%sizeof(float)!=0 || rate<8000 || rate>96000) return 2;
  const int length=static_cast<int>(bytes/sizeof(float));
  if (length>rate*15 || frames>rate*30 || attack<0 || frames<=attack || length<=attack ||
      join<0 || join>std::min(frames,length)-attack) return 2;
  std::vector<float> source(length), result(frames);
  input.seekg(0);
  if (!input.read(reinterpret_cast<char *>(source.data()), bytes)) return 2;
  signalsmith::stretch::SignalsmithStretch<float> stretch(89);
  stretch.presetDefault(1,rate);
  stretch.setTransposeSemitones(pitch);
  stretch.setFormantSemitones(formant,true);
  stretch.setFormantBase(root/rate);
  const float *src[]={source.data()+attack};
  float *out[]={result.data()+attack};
  if (!stretch.exact(src,length-attack,out,frames-attack)) {
    std::cerr << "Slice is shorter than Signalsmith's exact processing pre-roll\n";
    return 3;
  }
  std::copy_n(source.begin(),attack,result.begin());
  for (int i=0;i<join;i++) {
    const float u=.5f-.5f*std::cos(3.14159265f*i/join);
    result[attack+i]=source[attack+i]*(1-u)+result[attack+i]*u;
  }
  std::ofstream output(argv[2],std::ios::binary);
  if (!output.write(reinterpret_cast<const char *>(result.data()),frames*sizeof(float))) return 4;
  std::cout << "{\"frames\":" << frames << ",\"inputLatency\":" << stretch.inputLatency()
            << ",\"outputLatency\":" << stretch.outputLatency() << "}\n";
}
