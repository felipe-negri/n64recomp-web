#!/usr/bin/env python3
"""N64 adaptativo, passo 1: o syms.toml do N64Recomp sem decomp nem símbolos do jogo.

usage: gen_syms.py <rom.z64> <saída> <builtin_signatures.sig> <N64ModernRuntime>
Roda o splat (create_config + split) para achar o segmento principal e dividi-lo em funções (spimdisasm), nomeia
as funções da libultra pelas assinaturas do n64sym (o runtime troca essas pelo nome) e escreve em <saída>:
syms.toml (seções entry e main com as funções) e game.toml (config do N64Recomp)."""
import re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from libultra_sigs import load_sigs, scan  # noqa: E402


def segments(yaml_text):
    """entry: (rom, vram); main: (rom, vram, fim do código na ROM)."""
    entry = re.search(r"name: entry\s+type: code\s+start: (0x[0-9A-Fa-f]+)\s+vram: (0x[0-9A-Fa-f]+)", yaml_text)
    main = re.search(r"name: main\s+type: code\s+start: (0x[0-9A-Fa-f]+)\s+vram: (0x[0-9A-Fa-f]+).*?"
                     r"subsegments:\s*\n\s*- \[(0x[0-9A-Fa-f]+), asm\]\s*\n\s*- \[(0x[0-9A-Fa-f]+)", yaml_text, re.S)
    if not entry or not main:
        sys.exit("o splat não achou entry/main nesta ROM (código comprimido? fica para o modo com descoberta em runtime)")
    return (int(entry[1], 16), int(entry[2], 16)), (int(main[1], 16), int(main[2], 16), int(main[4], 16))


def by_error_codes(code, base, addr, found):
    """libultra de depuração (_d): cada função confere os argumentos e chama __osError(ERR_xxx, ...) com códigos
    próprios. Uma função que as assinaturas não acharam recebe o nome cujos códigos batem com os que ela usa
    (ultra_errors.json, tirado do ultralib). __osError é o alvo de jal mais comum logo após "li a0, código"."""
    import json, rabbitizer
    table = {int(k): v for k, v in json.loads((HERE / "ultra_errors.json").read_text()).items()}  # código -> {nome: nº de args}
    calls = {}  # função -> [(código, alvo)]
    for start in addr.values():
        off = start - base
        if off < 0 or off >= len(code):
            continue
        a0, prev = None, None
        for i in range(off, min(len(code), off + 0x400), 4):
            ins = rabbitizer.Instruction(int.from_bytes(code[i:i + 4], "big"), base + i)
            if ins.isFunctionCall() and ins.isJumpWithAddress():
                tgt = ins.getInstrIndexAsVram()
                nxt = rabbitizer.Instruction(int.from_bytes(code[i + 4:i + 8], "big"), base + i + 4)
                imm = None
                for cand in (prev, nxt):  # li a0, x pode vir antes do jal ou no delay slot
                    if cand and cand.uniqueId == rabbitizer.InstrId.cpu_addiu and cand.rs == rabbitizer.RegGprO32.zero \
                            and cand.rt == rabbitizer.RegGprO32.a0:
                        imm = cand.getProcessedImmediate()
                if imm is not None:
                    calls.setdefault(start, []).append((imm, tgt))
            if ins.isReturn():
                break
            prev = ins
    from collections import Counter
    def looks_like_oserror(t):  # __osError só repassa para os handlers: sem pilha, jr num registro lido de global
        off = t - base
        if not 0 <= off < len(code):
            return False
        ins = [rabbitizer.Instruction(int.from_bytes(code[i:i + 4], "big"), base + i) for i in range(off, off + 0x40, 4)]
        return not any(x.uniqueId == rabbitizer.InstrId.cpu_addiu and x.rt == rabbitizer.RegGprO32.sp for x in ins) \
            and any(x.isJump() and not x.isJumpWithAddress() and x.rs != rabbitizer.RegGprO32.ra for x in ins)
    err = next((t for t, _ in Counter(t for v in calls.values() for _, t in v).most_common() if looks_like_oserror(t)), None)
    if err is None:
        return {}
    named = {}
    for start, v in calls.items():
        if start in found:
            continue
        cands = None
        for imm, t in v:
            if t == err and imm in table:
                cands = set(table[imm]) if cands is None else cands & set(table[imm]) or cands
        if cands and len(cands) > 1:  # mesmos códigos (osPiStartDma/osEPiStartDma): desempata pelos args salvos
            stored = args_stored(code, base, start)
            nargs = {n: table[next(i for i, _ in v if i in table)][n] for n in cands}
            fit = {n for n in cands if min(nargs[n], 4) == stored}
            cands = fit or cands
        if cands and len(cands) == 1:
            named[start] = (0, next(iter(cands)))
    named[err] = (0, "__osError")
    return named


def args_stored(code, base, start):
    """Quantos de a0..a3 o prólogo (libultra _d, compilada sem otimização) guarda na pilha."""
    import rabbitizer
    regs = {rabbitizer.RegGprO32.a0, rabbitizer.RegGprO32.a1, rabbitizer.RegGprO32.a2, rabbitizer.RegGprO32.a3}
    seen = set()
    for i in range(start - base, start - base + 0x40, 4):
        ins = rabbitizer.Instruction(int.from_bytes(code[i:i + 4], "big"), base + i)
        if ins.uniqueId == rabbitizer.InstrId.cpu_sw and ins.rt in regs:
            seen.add(ins.rt)
    return len(seen)


def runtime_names(rt):
    """Funções da libultra que o N64Recomp troca por <nome>_recomp (reimplemented_funcs) e as que o runtime tem de fato.
    Uma que ele troca e o runtime não tem fica com o nome genérico: o código do jogo é recompilado como qualquer outro."""
    rt = Path(rt)
    lists = (rt / "N64Recomp/src/symbol_lists.cpp").read_text()
    block = lambda k: lists[lists.index(k):lists.index("};", lists.index(k))]
    # reimplemented: chamadas viram <nome>_recomp; ignored: o N64Recomp não gera a função (o runtime cobre quem chama)
    reimpl = set(re.findall(r'"([A-Za-z_0-9]+)"', block("reimplemented_funcs") + block("ignored_funcs {")))
    impl = set()
    for f in list((rt / "librecomp/src").glob("*.cpp")) + list((rt / "ultramodern/src").glob("*.cpp")):
        impl |= set(re.findall(r'\b([A-Za-z_0-9]+)_recomp\s*\(\s*(?:uint8_t\s*\*|RDRAM_ARG)', f.read_text(errors="replace")))
    return reimpl, impl


def main(rom, out, sigs, rt):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    rom_link = out / "rom.z64"
    if not rom_link.exists():
        rom_link.symlink_to(Path(rom).resolve())
    py = sys.executable
    subprocess.run([py, "-m", "splat", "create_config", "rom.z64"], cwd=out, check=True, stdout=subprocess.DEVNULL)
    yaml = next(p for p in out.glob("*.yaml"))
    text = yaml.read_text()
    (e_rom, e_vram), (m_rom, m_vram, m_end) = segments(text)
    subprocess.run([py, "-m", "splat", "split", yaml.name], cwd=out, check=True, stdout=subprocess.DEVNULL)

    asm = (out / "asm" / f"{m_rom:X}.s").read_text()
    funcs = [(n, int(s, 16)) for n, s in re.findall(r"^nonmatching (\S+), (0x[0-9A-Fa-f]+)", asm, re.M)]
    addr = {n: int(n.split("_")[-1], 16) for n, _ in funcs if re.fullmatch(r"func_[0-9A-F]{8}", n)}
    data = Path(rom).read_bytes()
    code = data[m_rom:m_end]
    found = scan(load_sigs(sigs), code, m_vram, [a - m_vram for a in addr.values()])

    # Entradas que só a execução revela (ponteiros de função): extra.txt, um endereço por linha, que o laço de
    # descoberta escreve a partir de "Failed to find function at". Cada uma corta a função que a contém.
    extra = out / "extra.txt"
    if extra.exists():
        cuts = sorted({int(x, 16) for x in extra.read_text().split()})
        spans = sorted((addr[n], n, size) for n, size in funcs if n in addr)
        new = []
        for start, n, size in spans:
            inner = [c for c in cuts if start < c < start + size]
            for a, b in zip([start] + inner, inner + [start + size]):
                nm = n if a == start else f"func_{a:08X}"
                new.append((nm, b - a))
                addr[nm] = a
        starts = sorted(a for a, _, _ in spans) + [m_vram + (m_end - m_rom)]
        for c in cuts:  # num buraco entre funções: vai até o começo da próxima
            if not any(a <= c < a + sz for a, _, sz in spans):
                nm = f"func_{c:08X}"
                new.append((nm, min(x for x in starts if x > c) - c))
                addr[nm] = c
        funcs = new
    found.update(by_error_codes(code, m_vram, addr, found))
    reimpl, impl = runtime_names(rt)
    entries, names = [], set()
    for n, size in funcs:
        vram = addr.get(n)
        if vram is None:  # nome que o splat já deu (main etc.): pega o endereço pelo glabel seguido do código
            continue
        name = found.get(vram, (None, n))[1]
        if name in reimpl and name not in impl:
            name = n
        if name in names and not (name in reimpl and name in impl):  # a mesma função da lib em duas versões
            name = f"{name}_{vram:08X}"  # (as que o runtime troca podem repetir: todas viram a dele)
        names.add(name)
        entries.append(f'    {{ name = "{name}", vram = 0x{vram:08X}, size = 0x{size:X} }},')
    e_size = m_vram - e_vram
    toml = [
        "# Gerado por adapt/gen_syms.py (splat + assinaturas do n64sym), sem decomp.",
        "[[section]]", 'name = ".entry"', f"rom = 0x{e_rom:08X}", f"vram = 0x{e_vram:08X}", f"size = 0x{e_size:X}", "",
        "functions = [", f'    {{ name = "recomp_entrypoint", vram = 0x{e_vram:08X}, size = 0x{e_size:X} }},', "]", "",
        "[[section]]", 'name = ".main"', f"rom = 0x{m_rom:08X}", f"vram = 0x{m_vram:08X}", f"size = 0x{m_end - m_rom:X}", "",
        "functions = [", *entries, "]", "",
    ]
    (out / "syms.toml").write_text("\n".join(toml))
    (out / "game.toml").write_text("\n".join([
        "[input]", f"entrypoint = 0x{e_vram:08X}", 'symbols_file_path = "syms.toml"', 'rom_file_path = "rom.z64"',
        'output_func_path = "RecompiledFuncs"', "", "[patches]", "stubs = []", "ignored = []", ""]))
    print(f"{len(entries)} funções, {len(found)} da libultra/SDK; main 0x{m_rom:X}-0x{m_end:X} em 0x{m_vram:08X}")


if __name__ == "__main__":
    main(*sys.argv[1:5])
