// N64 adaptativo: valores plausíveis para os registradores do RCP que código de libultra não reconhecido lê direto.
// Com RECOMP_MMIO_WINDOW, recomp.h leva 0xA4000000-0xA4FFFFFF para a janela depois da kseg0; esta thread mantém
// ali o que um N64 ocioso mostraria (RSP parado, PI/SI/AI livres) e a linha atual do VI andando no ritmo de 60 Hz.
// O resto (DMA, tarefas do RSP, VI de verdade) continua no runtime, pelas funções que ele substitui.
#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>
#include <cstdio>

#include "recomp.h"

extern "C" void recomp_entrypoint(uint8_t* rdram, recomp_context* ctx);

#include "trace.h"

namespace {
AdaptTraceStack* adapt_stacks[64];
std::atomic<int> adapt_num_stacks{0};
}

extern "C" AdaptTraceStack* adapt_trace_stack(void) {
    thread_local AdaptTraceStack* mine = nullptr;
    if (!mine) {
        mine = new AdaptTraceStack{};
        int i = adapt_num_stacks.fetch_add(1);
        if (i < 64) adapt_stacks[i] = mine;
    }
    return mine;
}

namespace {
void poke(uint8_t* rdram, uint32_t reg, uint32_t value) {
    // Mesmo endereço que o código recompilado lê com MEM_W (palavras na ordem do host).
    *reinterpret_cast<volatile uint32_t*>(rdram + RECOMP_RDRAM_OFFSET((gpr)(int32_t)(0xA0000000u | reg))) = value;
}

void mmio_loop(uint8_t* rdram) {
    using clock = std::chrono::steady_clock;
    const auto start = clock::now();
    while (true) {
        uint64_t us = std::chrono::duration_cast<std::chrono::microseconds>(clock::now() - start).count();
        poke(rdram, 0x04040010, 0x1);   // SP_STATUS: halted
        poke(rdram, 0x04040018, 0x0);   // SP_DMA_BUSY
        poke(rdram, 0x0410000C, 0x0);   // DPC_STATUS
        poke(rdram, 0x04500004, 0x0);   // AI_LEN
        poke(rdram, 0x0450000C, 0x0);   // AI_STATUS
        poke(rdram, 0x04600010, 0x0);   // PI_STATUS
        poke(rdram, 0x04800018, 0x0);   // SI_STATUS
        poke(rdram, 0x04400010, (uint32_t)((us % 16683) * 525 / 16683));  // VI_CURRENT: 525 meias-linhas por quadro
        static uint64_t last_report = 0;
        if (us - last_report > 5000000) {  // rastreio: a pilha de cada thread do jogo, a cada 5 s
            last_report = us;
            for (int t = 0; t < adapt_num_stacks.load() && t < 64; t++) {
                AdaptTraceStack* st = adapt_stacks[t];
                if (!st || st->n == 0) continue;
                fprintf(stderr, "adapt-where t%d:", t);
                for (int k = 0; k < st->n && k < 48; k++) fprintf(stderr, " %s", st->f[k]);
                fprintf(stderr, "\n");
            }
        }
        std::this_thread::sleep_for(std::chrono::microseconds(200));
    }
}
}

extern "C" uint8_t* adapt_rdram = nullptr;

extern "C" void adapt_entrypoint(uint8_t* rdram, recomp_context* ctx) {
    adapt_rdram = rdram;
    static std::atomic<bool> started{false};
    if (!started.exchange(true)) {
        std::thread(mmio_loop, rdram).detach();
    }
    recomp_entrypoint(rdram, ctx);
}
