// N64 adaptativo: valores plausíveis para os registradores do RCP que código de libultra não reconhecido lê direto.
// Com RECOMP_MMIO_WINDOW, recomp.h leva 0xA4000000-0xA4FFFFFF para a janela depois da kseg0; esta thread mantém
// ali o que um N64 ocioso mostraria (RSP parado, PI/SI/AI livres) e a linha atual do VI andando no ritmo de 60 Hz.
// O resto (DMA, tarefas do RSP, VI de verdade) continua no runtime, pelas funções que ele substitui.
#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>
#include <algorithm>
#include <cstdio>

#include "recomp.h"
#include "ultramodern/ultramodern.hpp"
#include "recompinput/profiles.h"
#include "recompinput/recompinput.h"

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


// SI no nível de registrador, para rotinas do SI/Controller Pak que a libultra não reconhecida faz direto no hardware:
// o jogo escreve SI_DRAM_ADDR e depois SI_PIF_ADDR_WR64B (manda 64 bytes ao PIF) ou _RD64B (lê de volta). A thread vê a
// escrita (o registro volta do sentinela), faz a cópia, roda os comandos joybus com a entrada do runtime (controle 1
// ligado, sem Controller Pak, demais portas vazias) e avisa o jogo pelo evento SI do runtime.
constexpr uint32_t SI_DRAM_ADDR = 0x04800000, SI_RD64B = 0x04800004, SI_WR64B = 0x04800010, SENTINEL = 0xDEADBEEFu;
uint8_t pif_ram[64];

uint32_t peek(uint8_t* rdram, uint32_t reg) {
    return *reinterpret_cast<volatile uint32_t*>(rdram + RECOMP_RDRAM_OFFSET((gpr)(int32_t)(0xA0000000u | reg)));
}

uint8_t& rd_byte(uint8_t* rdram, uint32_t addr) {  // byte de um endereço do N64 (palavras na ordem do host)
    return *(rdram + RECOMP_RDRAM_OFFSET((gpr)(int32_t)(addr ^ 3)));
}

void pif_run() {
    int ch = 0;
    for (int i = 0; i < 63 && ch < 6;) {
        uint8_t c = pif_ram[i];
        if (c == 0xFE) break;
        if (c == 0xFF || c == 0xFD) { i++; continue; }
        if (c == 0x00) { ch++; i++; continue; }
        int tx = c & 0x3F, rx = pif_ram[i + 1] & 0x3F;
        if (i + 2 + tx + rx > 63) break;
        uint8_t cmd = pif_ram[i + 2];
        uint8_t* res = &pif_ram[i + 2 + tx];
        if (ch != 0 || cmd == 0x02 || cmd == 0x03) {
            pif_ram[i + 1] |= 0x80;  // ninguém respondeu
        } else if (cmd == 0x00 || cmd == 0xFF) {
            if (rx >= 3) { res[0] = 0x05; res[1] = 0x00; res[2] = 0x02; }  // controle padrão, sem pak
        } else if (cmd == 0x01) {
            uint16_t buttons = 0; float x = 0, y = 0;
            recompinput::profiles::get_n64_input(0, &buttons, &x, &y);
            if (rx >= 4) {
                res[0] = buttons >> 8; res[1] = buttons & 0xFF;
                res[2] = (uint8_t)(int8_t)std::max(-85.0f, std::min(85.0f, x * 85.0f));
                res[3] = (uint8_t)(int8_t)std::max(-85.0f, std::min(85.0f, y * 85.0f));
            }
        } else {
            pif_ram[i + 1] |= 0x80;
        }
        i += 2 + tx + rx;
        ch++;
    }
    pif_ram[63] = 0;
}

void si_poll(uint8_t* rdram) {
    uint32_t wr = peek(rdram, SI_WR64B), rd = peek(rdram, SI_RD64B);
    uint32_t dram = 0x80000000u | (peek(rdram, SI_DRAM_ADDR) & 0x00FFFFFFu);
    if (wr != SENTINEL) {
        poke(rdram, SI_WR64B, SENTINEL);
        if (wr != 0) {
            for (int i = 0; i < 64; i++) pif_ram[i] = rd_byte(rdram, dram + i);
            pif_run();
            ultramodern::send_si_message();
        }
    }
    if (rd != SENTINEL) {
        poke(rdram, SI_RD64B, SENTINEL);
        if (rd != 0) {
            for (int i = 0; i < 64; i++) rd_byte(rdram, dram + i) = pif_ram[i];
            ultramodern::send_si_message();
        }
    }
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
        si_poll(rdram);
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
