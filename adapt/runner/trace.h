#pragma once
// N64 adaptativo, modo de rastreio (trace_mode no game.toml): a primeira entrada em cada função vai para o console, e
// cada thread do jogo mantém a pilha das funções em que está (adapt_mmio.cpp mostra todas de tempos em tempos).
#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { const char* f[48]; int n; } AdaptTraceStack;
AdaptTraceStack* adapt_trace_stack(void);
#ifdef __cplusplus
}
#endif
#define TRACE_ENTRY() { AdaptTraceStack* recomp_ts = adapt_trace_stack(); if (recomp_ts->n < 48) recomp_ts->f[recomp_ts->n] = __func__; recomp_ts->n++; \
    static int recomp_trace_seen; if (!recomp_trace_seen) { recomp_trace_seen = 1; printf("trace %s\n", __func__); } }
#define TRACE_RETURN() { AdaptTraceStack* recomp_ts = adapt_trace_stack(); if (recomp_ts->n > 0) recomp_ts->n--; }
