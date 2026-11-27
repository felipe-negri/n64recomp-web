#!/usr/bin/env python3
"""N64 adaptativo: funções de um segmento de código pelo fluxo de execução, não por heurística de divisão.

A partir das entradas conhecidas (alvos de jal, ponteiros lui/addiu para dentro do segmento, endereços que a execução
revelou), segue desvios e saltos até "jr ra"/fim e descobre o tamanho exato de cada função. O que nunca é alcançado
(dados, tabelas) fica fora: o N64Recomp não tenta recompilar lixo. Tabelas de salto (lui/addiu + lw + jr) são lidas
para seguir os casos. Uma entrada conhecida é sempre começo de função: o fluxo de outra para ali (chamada de cauda)."""
import rabbitizer as rz

Id = rz.InstrId
R = rz.RegGprO32


def words(rom, r, n):
    return [int.from_bytes(rom[r + i:r + i + 4], "big") for i in range(0, n - n % 4, 4)]


def entries_from_code(ws, base, lo, hi):
    """Alvos de jal e endereços montados com lui/addiu (ou lui/ori) que caem em [lo, hi)."""
    out, hi16 = set(), {}
    for i, w in enumerate(ws):
        ins = rz.Instruction(w, base + i * 4)
        if ins.uniqueId == Id.cpu_jal:
            t = ins.getInstrIndexAsVram()
            if lo <= t < hi:
                out.add(t)
        elif ins.uniqueId == Id.cpu_lui:
            hi16[ins.rt] = ins.getProcessedImmediate() << 16
        elif ins.uniqueId in (Id.cpu_addiu, Id.cpu_ori) and ins.rs in hi16:
            imm = ins.getProcessedImmediate()
            v = (hi16[ins.rs] | imm) if ins.uniqueId == Id.cpu_ori else (hi16[ins.rs] + imm) & 0xFFFFFFFF
            if lo <= v < hi and v % 4 == 0:
                out.add(v)
    return out


def functions(rom, r, vram, n, entries):
    """[(vram, tamanho)] das funções alcançáveis a partir de entries dentro do segmento."""
    lo, hi = vram, vram + n
    ws = words(rom, r, n)
    at = lambda a: rz.Instruction(ws[(a - lo) // 4], a) if lo <= a < hi and (a - lo) // 4 < len(ws) else None
    starts = set(e for e in entries if lo <= e < hi)
    queue, done, funcs = sorted(starts), set(), {}
    while queue:
        e = queue.pop()
        if e in done:
            continue
        done.add(e)
        seen, todo, end, ok = set(), [e], e, True
        while todo:
            a = todo.pop()
            while lo <= a < hi and a not in seen:
                if a != e and a in starts:  # caiu no começo de outra função: chamada de cauda
                    break
                ins = at(a)
                if ins is None or not ins.isValid():
                    ok = False
                    break
                seen.add(a)
                end = max(end, a + 8 if ins.isBranch() or ins.isJump() else a + 4)
                if ins.isFunctionCall() and ins.uniqueId == Id.cpu_jal:
                    t = ins.getInstrIndexAsVram()
                    if lo <= t < hi and t not in starts:
                        starts.add(t)
                        queue.append(t)
                if ins.isBranch():
                    tgt = ins.getBranchVramGeneric()
                    todo.append(tgt)
                    if ins.isUnconditionalBranch():
                        seen.add(a + 4)
                        break
                elif ins.uniqueId == Id.cpu_j:
                    t = ins.getInstrIndexAsVram()
                    seen.add(a + 4)
                    if lo <= t < hi and t not in starts and t > e:
                        todo.append(t)  # salto dentro da própria função
                    break
                elif ins.uniqueId == Id.cpu_jr:
                    seen.add(a + 4)
                    if ins.rs != R.ra:
                        todo += jumptable(ws, lo, hi, a)
                    break
                a += 4
        if ok and end > e:
            funcs[e] = end - e
    # não pode haver sobreposição: uma função termina onde a próxima começa
    out, order = [], sorted(funcs)
    for i, s in enumerate(order):
        size = funcs[s]
        if i + 1 < len(order):
            size = min(size, order[i + 1] - s)
        out.append((s, size))
    return out


def jumptable(ws, lo, hi, jr_addr):
    """Casos de um "jr reg" de switch: procura para trás o lw da tabela e o lui/addiu do endereço dela."""
    i = (jr_addr - lo) // 4
    hi16, table = {}, None
    for k in range(max(0, i - 12), i):
        ins = rz.Instruction(ws[k], lo + k * 4)
        if ins.uniqueId == Id.cpu_lui:
            hi16[ins.rt] = ins.getProcessedImmediate() << 16
        elif ins.uniqueId in (Id.cpu_addiu, Id.cpu_lw) and ins.rs in hi16:
            table = (hi16[ins.rs] + ins.getProcessedImmediate()) & 0xFFFFFFFF
    out = []
    if table and lo <= table < hi:
        k = (table - lo) // 4
        while k < len(ws) and lo <= ws[k] < hi and len(out) < 512:
            out.append(ws[k])
            k += 1
    return out


if __name__ == "__main__":
    import sys
    rom = open(sys.argv[1], "rb").read()
    r, v, n = (int(x, 16) for x in sys.argv[2:5])
    ws = words(rom, r, n)
    ent = entries_from_code(ws, v, v, v + n) | {int(x, 16) for x in sys.argv[5:]}
    fs = functions(rom, r, v, n, ent)
    print(len(ent), "entradas;", len(fs), "funções;", hex(sum(s for _, s in fs)), "bytes de código de", hex(n))
