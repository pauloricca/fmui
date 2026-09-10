#include "ymfm_opz.h"
#include "ymfm_fm.ipp"

// The chip is owned exclusively by the Rust audio thread. No CPU/ROM emulation.
class Chip : public ymfm::ym2414 {
public:
    explicit Chip(ymfm::ymfm_interface& interface) : ym2414(interface) {}
    void steal(unsigned channel) {
        // Voice allocation is firmware, not chip emulation. Reset only the
        // stolen slot, without advancing/discarding other channels' audio.
        m_fm.debug_channel(channel)->reset();
        for (unsigned slot : {0u,8u,16u,24u}) m_fm.debug_operator(channel+slot)->reset();
        m_fm.invalidate_caches();
    }
};
struct Opz {
    ymfm::ymfm_interface interface;
    Chip chip;
    Opz() : chip(interface) { chip.reset(); }
};
extern "C" {
void* opz_new() { return new Opz; }
void opz_free(void* p) { delete static_cast<Opz*>(p); }
void opz_reset(void* p) { static_cast<Opz*>(p)->chip.reset(); }
void opz_steal(void* p, unsigned channel) { static_cast<Opz*>(p)->chip.steal(channel); }
void opz_write(void* p, unsigned char reg, unsigned char value) {
    auto& chip = static_cast<Opz*>(p)->chip;
    chip.write_address(reg);
    chip.write_data(value);
}
void opz_sample(void* p, float* output) {
    ymfm::ym2414::output_data sample;
    static_cast<Opz*>(p)->chip.generate(&sample);
    output[0] = sample.data[0] / 32768.0f;
    output[1] = sample.data[1] / 32768.0f;
}
}
