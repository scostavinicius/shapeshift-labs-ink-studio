// Small test insert with state, timestamped trim, a mono key, and a delayed echo.
#include <clap/clap.h>
#include <array>
#include <cstring>

namespace {
const char *features[]={CLAP_PLUGIN_FEATURE_AUDIO_EFFECT,nullptr};
const clap_plugin_descriptor_t descriptor{CLAP_VERSION,"org.ink.rack-fixture","Relay Test","Ink","","","","1","",features};
constexpr uint32_t latency=7, tail=29, trim=6;
struct Effect {
  double gain=.5;
  uint32_t at=0;
  std::array<std::array<float,64>,2> line{};
  static Effect &get(const clap_plugin_t *p) {return *static_cast<Effect *>(p->plugin_data);}
  static void events(const clap_plugin_t *p,const clap_input_events_t *input,uint32_t frame,uint32_t &index) {
    auto &d=get(p);
    while (index<input->size(input)) {
      const auto *event=input->get(input,index);
      if (event->time>frame) break;
      if (event->space_id==CLAP_CORE_EVENT_SPACE_ID && event->type==CLAP_EVENT_PARAM_VALUE) {
        const auto *value=reinterpret_cast<const clap_event_param_value_t *>(event);
        if (value->param_id==trim) d.gain=value->value;
      }
      index++;
    }
  }
  clap_plugin_t plugin{&descriptor,this,
    [](const clap_plugin_t *) {return true;},
    [](const clap_plugin_t *p) {delete &get(p);},
    [](const clap_plugin_t *,double,uint32_t,uint32_t) {return true;},
    [](const clap_plugin_t *) {},
    [](const clap_plugin_t *) {return true;},
    [](const clap_plugin_t *) {},
    [](const clap_plugin_t *p) {get(p).line={};get(p).at=0;},
    [](const clap_plugin_t *p,const clap_process_t *job)->clap_process_status {
      auto &d=get(p);
      uint32_t index=0;
      for (uint32_t i=0;i<job->frames_count;i++,d.at++) {
        events(p,job->in_events,i,index);
        const float factor=job->audio_inputs[1].data32[0][i]>.125f ? .25f : 1.f;
        for (uint32_t c=0;c<2;c++) {
          auto &line=d.line[c];
          line[d.at%64]=job->audio_inputs[0].data32[c][i]*factor*float(d.gain);
          job->audio_outputs[0].data32[c][i]=line[(d.at+64-latency)%64]+.125f*line[(d.at+64-latency-tail)%64];
        }
      }
      return CLAP_PROCESS_CONTINUE;
    },
    [](const clap_plugin_t *,const char *id)->const void * {
      static const clap_plugin_latency_t delay{[](const clap_plugin_t *){return latency;}};
      static const clap_plugin_tail_t decay{[](const clap_plugin_t *){return tail;}};
      static const clap_plugin_audio_ports_t ports{
        [](const clap_plugin_t *,bool in)->uint32_t{return in ? 2 : 1;},
        [](const clap_plugin_t *,uint32_t i,bool in,clap_audio_port_info_t *info) {
          if (i>0 && (!in || i!=1)) return false;
          *info={};
          info->id=i;info->channel_count=i==0 ? 2 : 1;info->flags=i==0 ? CLAP_AUDIO_PORT_IS_MAIN : 0;
          info->port_type=i==0 ? CLAP_PORT_STEREO : CLAP_PORT_MONO;
          std::strcpy(info->name,i==0 ? "Program" : "Key");
          return true;
        }
      };
      static const clap_plugin_params_t params{
        [](const clap_plugin_t *)->uint32_t{return 1;},
        [](const clap_plugin_t *,uint32_t index,clap_param_info_t *info){
          if (index) return false;
          *info={};info->id=trim;info->flags=CLAP_PARAM_IS_AUTOMATABLE;info->max_value=2;info->default_value=.5;
          std::strcpy(info->name,"Trim");return true;
        },
        [](const clap_plugin_t *p,clap_id id,double *value){*value=get(p).gain;return id==trim;},
        [](const clap_plugin_t *,clap_id,double,char *,uint32_t){return false;},
        [](const clap_plugin_t *,clap_id,const char *,double *){return false;},
        [](const clap_plugin_t *p,const clap_input_events_t *list,const clap_output_events_t *){
          uint32_t index=0;events(p,list,0,index);
        }
      };
      static const clap_plugin_state_t state{
        [](const clap_plugin_t *p,const clap_ostream_t *out) {
          return out->write(out,&get(p).gain,sizeof(double))==sizeof(double);
        },
        [](const clap_plugin_t *p,const clap_istream_t *in) {
          return in->read(in,&get(p).gain,sizeof(double))==sizeof(double);
        }
      };
      if (!std::strcmp(id,CLAP_EXT_AUDIO_PORTS)) return &ports;
      if (!std::strcmp(id,CLAP_EXT_PARAMS)) return &params;
      if (!std::strcmp(id,CLAP_EXT_STATE)) return &state;
      if (!std::strcmp(id,CLAP_EXT_LATENCY)) return &delay;
      if (!std::strcmp(id,CLAP_EXT_TAIL)) return &decay;
      return nullptr;
    },
    [](const clap_plugin_t *) {}};
};
const clap_plugin_factory_t factory{
  [](const clap_plugin_factory_t *)->uint32_t{return 1;},
  [](const clap_plugin_factory_t *,uint32_t i)->const clap_plugin_descriptor_t * {return i==0 ? &descriptor : nullptr;},
  [](const clap_plugin_factory_t *,const clap_host_t *,const char *id)->const clap_plugin_t * {
    return std::strcmp(id,descriptor.id) ? nullptr : &(new Effect)->plugin;
  }};
} // namespace
extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry{CLAP_VERSION,
  [](const char *){return true;},[](){},[](const char *id)->const void * {
    return std::strcmp(id,CLAP_PLUGIN_FACTORY_ID) ? nullptr : &factory;
  }};
