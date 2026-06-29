#!/usr/bin/env bash
# agentor.sh — multi-repo AI task workflow CLI
set -euo pipefail

AGENTOR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$AGENTOR_DIR/config.yaml"
CONTRACTS_DIR="$AGENTOR_DIR/contracts"
RUNS_DIR="$AGENTOR_DIR/runs"
TEMPLATES_DIR="$AGENTOR_DIR/templates"

# ── Terminal colors ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }
info() { echo -e "${CYAN}→${NC} $*"; }
hdr()  { echo -e "\n${BOLD}$*${NC}"; }

# ── Dependency check ───────────────────────────────────────────────────────────
check_deps() {
    if ! python3 -c "import yaml" 2>/dev/null; then
        err "PyYAML not found. Install with: pip3 install pyyaml"
        exit 1
    fi
}

# ── YAML → shell variables ─────────────────────────────────────────────────────
load_contract() {
    local task="$1"
    local parent_task="$task"
    [[ "$task" =~ (.+)(-F[0-9]+)$ ]] && parent_task="${BASH_REMATCH[1]}"
    local contract_file="$CONTRACTS_DIR/$parent_task/$task.yaml"
    [[ -f "$contract_file" ]] || contract_file="$CONTRACTS_DIR/$task.yaml"

    [[ -f "$CONFIG" ]]        || { err "Config not found: $CONFIG"; exit 1; }
    [[ -f "$contract_file" ]] || { err "Contract not found: $contract_file"; exit 1; }

    check_deps

    eval "$(python3 - "$CONFIG" "$contract_file" <<'PYEOF'
import sys, yaml

cfg_path, contract_path = sys.argv[1], sys.argv[2]

with open(cfg_path) as f:
    cfg = yaml.safe_load(f)
with open(contract_path) as f:
    contract = yaml.safe_load(f)

workspace_root = cfg['workspace_root'].rstrip('/')
repo_map = cfg.get('repos', {})
repos = contract.get('repos', [])

def q(s): return str(s).replace("'", "'\\''")

print(f"WORKSPACE_ROOT='{q(workspace_root)}'")
print(f"TASK_TITLE='{q(contract.get('title', ''))}'")
print(f"REPOS_COUNT={len(repos)}")

for i, r in enumerate(repos):
    alias = r['alias']
    cr    = repo_map.get(alias, {})
    path  = cr.get('path', '')
    role  = r.get('role', 'secondary')
    rtype = cr.get('type', 'unknown')
    tcmd  = r.get('test_command') or cr.get('test_command', '')
    paths = '|'.join(r.get('paths', []))

    if not path:
        print(f"echo 'ERROR: alias \"{alias}\" not found in config.yaml' >&2; exit 1", file=__import__('sys').stderr)
        raise SystemExit(1)

    print(f"REPO_{i}_ALIAS='{q(alias)}'")
    print(f"REPO_{i}_PATH='{q(path)}'")
    print(f"REPO_{i}_ROLE='{q(role)}'")
    print(f"REPO_{i}_TYPE='{q(rtype)}'")
    print(f"REPO_{i}_TEST_CMD='{q(tcmd)}'")
    print(f"REPO_{i}_PATHS='{q(paths)}'")
PYEOF
    )"

    export WORKSPACE_ROOT TASK_TITLE REPOS_COUNT
    for (( i=0; i<REPOS_COUNT; i++ )); do
        export "REPO_${i}_ALIAS" "REPO_${i}_PATH" "REPO_${i}_ROLE" \
               "REPO_${i}_TYPE" "REPO_${i}_TEST_CMD" "REPO_${i}_PATHS"
    done
}

# ── Helper: iterate repos ──────────────────────────────────────────────────────
for_each_repo() {
    local filter="${1:-}"
    for (( i=0; i<REPOS_COUNT; i++ )); do
        ALIAS="$(eval echo "\$REPO_${i}_ALIAS")"
        REPO_PATH="$(eval echo "\$REPO_${i}_PATH")"
        ROLE="$(eval echo "\$REPO_${i}_ROLE")"
        TEST_CMD="$(eval echo "\$REPO_${i}_TEST_CMD")"
        PATHS="$(eval echo "\$REPO_${i}_PATHS")"
        REPO_TYPE="$(eval echo "\$REPO_${i}_TYPE")"
        [[ -n "$filter" && "$ALIAS" != "$filter" ]] && continue
        yield_repo
    done
}

# Followups (TASK-001-F1) live in the parent's run dir (runs/TASK-001/).
resolve_run_dir() {
    local task="$1"
    if [[ "$task" =~ (.+)(-F[0-9]+)$ ]]; then
        RESOLVED_PARENT_TASK="${BASH_REMATCH[1]}"
        RESOLVED_SUFFIX="${BASH_REMATCH[2]}"
    else
        RESOLVED_PARENT_TASK="$task"
        RESOLVED_SUFFIX=""
    fi
    RESOLVED_RUN_DIR="$RUNS_DIR/$RESOLVED_PARENT_TASK"
}

# ── run ───────────────────────────────────────────────────────────────────────
cmd_run() {
    local task="$1"

    local parent_task="$task"
    local followup_suffix=""
    if [[ "$task" =~ (.+)(-F[0-9]+)$ ]]; then
        parent_task="${BASH_REMATCH[1]}"
        followup_suffix="${BASH_REMATCH[2]}"
    fi

    local run_dir="$RUNS_DIR/$parent_task"
    mkdir -p "$run_dir"

    load_contract "$task"

    hdr "Setting up task: $task — $TASK_TITLE"

    # Verify repos exist + write .claude/settings.json for auto-approve
    yield_repo() {
        local repo_abs="$WORKSPACE_ROOT/$REPO_PATH"
        [[ -d "$repo_abs" ]] || { err "[$ALIAS] Repo not found: $repo_abs"; return 1; }
        ok "[$ALIAS] $repo_abs ($ROLE)"

        # Write auto-approve settings so Claude doesn't ask permission for every tool call
        mkdir -p "$repo_abs/.claude"
        cat > "$repo_abs/.claude/settings.json" <<'JSON'
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "MultiEdit(*)",
      "Glob(*)",
      "Grep(*)",
      "LS(*)"
    ]
  }
}
JSON
        ok "[$ALIAS] auto-approve → .claude/settings.json"

        # Add .claude/ to .gitignore if not already there
        local gitignore="$repo_abs/.gitignore"
        if [[ -f "$gitignore" ]]; then
            if ! grep -qxF '.claude/' "$gitignore"; then
                echo '.claude/' >> "$gitignore"
                ok "[$ALIAS] .gitignore ← .claude/"
            fi
        fi
    }
    for_each_repo

    # Create workspace (initial run only — followups reuse existing workspace)
    local workspace_file="$run_dir/$parent_task.code-workspace"
    if [[ -z "$followup_suffix" ]]; then
        python3 - "$run_dir" "$parent_task" "$task" "$AGENTOR_DIR" <<PYEOF
import sys, json, os

run_dir, parent_task, task, agentor_dir = sys.argv[1:]
repos_count = int(os.environ.get('REPOS_COUNT', 0))
workspace_root = os.environ.get('WORKSPACE_ROOT', '')
sh = f"bash {agentor_dir}/agentor.sh"
ws_path = os.path.join(run_dir, f"{parent_task}.code-workspace")

folders = []
for i in range(repos_count):
    alias = os.environ[f'REPO_{i}_ALIAS']
    path  = os.environ[f'REPO_{i}_PATH']
    folders.append({"name": alias, "path": f"{workspace_root}/{path}"})
# Run dir as last folder for report/prompt access
folders.append({"name": f"runs/{parent_task}", "path": run_dir})

ws = {
    "folders": folders,
    "settings": {"scm.defaultViewMode": "tree", "workbench.startupEditor": "none"},
    "tasks": {"version": "2.0.0", "tasks": [
        {"label": "agentor: 📝 Review",        "type": "shell",
         "command": f"cd {agentor_dir} && {sh} review {task}",
         "presentation": {"reveal": "always", "panel": "shared", "focus": False}, "problemMatcher": []},
        {"label": "agentor: ▶ Next Iteration", "type": "shell",
         "command": f"cd {agentor_dir} && {sh} next {task}",
         "presentation": {"reveal": "always", "panel": "new", "focus": True}, "problemMatcher": []},
        {"label": "agentor: 📋 Status",        "type": "shell",
         "command": f"cd {agentor_dir} && {sh} status {task}",
         "presentation": {"reveal": "always", "panel": "shared"}, "problemMatcher": []},
    ]}
}

os.makedirs(run_dir, exist_ok=True)
with open(ws_path, 'w') as f:
    json.dump(ws, f, indent=2)
    f.write('\n')
print(ws_path)
PYEOF
        ok "workspace → $workspace_file"
    fi

    # Generate agent-prompt-current.md (always — both initial and followup)
    local template="$TEMPLATES_DIR/agent-prompt.md"
    if [[ -f "$template" ]]; then
        local contract_path="$CONTRACTS_DIR/$parent_task/$task.yaml"
        [[ -f "$contract_path" ]] || contract_path="$CONTRACTS_DIR/$task.yaml"
        python3 - "$CONFIG" "$contract_path" "$template" "$run_dir" "$task" "$CONTRACTS_DIR" "$AGENTOR_DIR" <<'PYEOF'
import sys, yaml, os, re

cfg_path, contract_path, template_path, run_dir, task, contracts_dir, agentor_dir = sys.argv[1:]

with open(cfg_path) as f:
    cfg = yaml.safe_load(f)
with open(contract_path) as f:
    contract = yaml.safe_load(f)
with open(template_path) as f:
    template = f.read()

workspace_root = cfg['workspace_root'].rstrip('/')
repos_count = int(os.environ.get('REPOS_COUNT', 0))

lines = []
for i in range(repos_count):
    alias    = os.environ[f'REPO_{i}_ALIAS']
    role     = os.environ[f'REPO_{i}_ROLE']
    path     = os.environ[f'REPO_{i}_PATH']
    test_cmd = os.environ[f'REPO_{i}_TEST_CMD']
    paths    = [p for p in os.environ[f'REPO_{i}_PATHS'].split('|') if p]
    lines.append(f"- alias: {alias}")
    lines.append(f"  role: {role}")
    lines.append(f"  repo_path: {workspace_root}/{path}")
    if paths:
        lines.append(f"  restricted_to_paths:")
        for p in paths:
            lines.append(f"    - {p}")
    lines.append(f"  test_command: \"{test_cmd}\"")
    lines.append("")

repo_list = "\n".join(lines)

# Load project memory for each repo
memory_dir = os.path.join(agentor_dir, 'memory')
memory_blocks = []
for i in range(repos_count):
    alias = os.environ[f'REPO_{i}_ALIAS']
    mem_path = os.path.join(memory_dir, f'{alias}.md')
    if os.path.exists(mem_path):
        content = open(mem_path).read().strip()
        if content:
            memory_blocks.append(f"### {alias}\n\n{content}")
memory = "\n\n---\n\n".join(memory_blocks)

# Build iteration history for followup tasks
m = re.match(r'^(.+)-F(\d+)$', task)
history_blocks = []
if m:
    parent = m.group(1)
    current_n = int(m.group(2))
    # Collect ancestors: base contract + last 4 followups (cap at 5 total to limit prompt size)
    recent_fn = [f"{parent}-F{i}" for i in range(max(1, current_n - 4), current_n)]
    ancestors = [parent] + recent_fn
    for anc in ancestors:
        anc_path = os.path.join(contracts_dir, parent, f"{anc}.yaml")
        if not os.path.exists(anc_path):
            anc_path = os.path.join(contracts_dir, f"{anc}.yaml")
        if not os.path.exists(anc_path):
            continue
        with open(anc_path) as f:
            anc_contract = yaml.safe_load(f)
        block = [f"### {anc} — {anc_contract.get('title', '')}"]
        goal_text = str(anc_contract.get('goal', '')).strip()
        # For followup entries strip the repeated "Original goal:" block — it is already in the base entry
        if anc != parent and 'Original goal:' in goal_text:
            goal_text = goal_text[:goal_text.index('Original goal:')].strip()
        block.append(f"**Goal:** {goal_text}")
        # Include report summary if available
        suffix = "" if anc == parent else f"-{anc.split('-F')[1]}" if '-F' in anc else ""
        # Reports are named report.md (F1), report-F1.md (older style), report-F2.md etc.
        report_candidates = []
        if anc == parent:
            report_candidates.append(os.path.join(run_dir, "report.md"))
        else:
            fn = anc.replace(parent + "-", "").lower()  # e.g. F1 → f1 — old style
            report_candidates.append(os.path.join(run_dir, f"report-{fn}.md"))
            report_candidates.append(os.path.join(run_dir, f"report-{fn.upper()}.md"))
        for rp in report_candidates:
            if os.path.exists(rp):
                with open(rp) as rf:
                    content = rf.read()
                # Extract just the Summary section
                summary_match = re.search(r'# Summary\n+(.*?)(?=\n#|\Z)', content, re.DOTALL)
                if summary_match:
                    block.append(f"**Report summary:** {summary_match.group(1).strip()}")
                break
        history_blocks.append("\n".join(block))

history = "\n\n---\n\n".join(history_blocks) if history_blocks else ""

report_path = f"{run_dir}/report.md"

processed = template
# Handle {{#MEMORY}}...{{/MEMORY}}
if memory:
    processed = processed.replace("{{#MEMORY}}", "").replace("{{/MEMORY}}", "").replace("{{MEMORY}}", memory)
else:
    processed = re.sub(r'\{\{#MEMORY\}\}.*?\{\{/MEMORY\}\}\n?', '', processed, flags=re.DOTALL)
# Handle {{#HISTORY}}...{{/HISTORY}}
if history:
    processed = processed.replace("{{#HISTORY}}", "").replace("{{/HISTORY}}", "").replace("{{HISTORY}}", history)
else:
    processed = re.sub(r'\{\{#HISTORY\}\}.*?\{\{/HISTORY\}\}\n?', '', processed, flags=re.DOTALL)

# Model hint
model_hint = contract.get('model_hint', '')
if model_hint == 'haiku':
    model_note = 'This task is scoped as a quick/mechanical fix. Use **claude-haiku-4-5-20251001** for ~70% token cost savings.'
elif model_hint:
    model_note = model_hint
else:
    model_note = ''

if model_note:
    processed = processed.replace("{{#MODEL_NOTE}}", "").replace("{{/MODEL_NOTE}}", "").replace("{{MODEL_NOTE}}", model_note)
else:
    import re as _re2
    processed = _re2.sub(r'\{\{#MODEL_NOTE\}\}.*?\{\{/MODEL_NOTE\}\}\n?', '', processed, flags=_re2.DOTALL)

result = (processed
    .replace("{{REPO_LIST}}", repo_list)
    .replace("{{CONTRACT}}", yaml.dump(contract, allow_unicode=True, default_flow_style=False))
    .replace("{{REPORT_PATH}}", report_path)
    .replace("{{TASK_ID}}", task)
    .replace("{{MEMORY_DIR}}", memory_dir)
    .replace("{{AGENTOR_DIR}}", agentor_dir))

out_path = f"{run_dir}/agent-prompt-current.md"
with open(out_path, 'w') as f:
    f.write(result)
print(out_path)
PYEOF
        ok "agent-prompt → $run_dir/agent-prompt-current.md"
    else
        warn "Template not found: $template — agent-prompt skipped"
    fi

    echo ""
    ok "Ready: $task"
    echo "  runs: $run_dir/"
    echo ""

    local code_cmd=""
    command -v code     &>/dev/null && code_cmd="code"
    command -v code.exe &>/dev/null && code_cmd="code.exe"

    if [[ -n "$followup_suffix" ]]; then
        echo -e "  ${BOLD}VS Code:${NC}  Ctrl+Shift+P → Reload Window"
        echo "  Prompt:   $run_dir/agent-prompt-current.md"
    else
        echo -e "  ${BOLD}Open in VS Code:${NC}"
        echo "    code $workspace_file"
        if [[ -n "$code_cmd" ]]; then
            info "Opening VS Code ($code_cmd)..."
            "$code_cmd" "$workspace_file" &
        fi
    fi
    echo ""
}

# ── clean ─────────────────────────────────────────────────────────────────────
cmd_clean() {
    local task="$1"
    resolve_run_dir "$task"
    local run_dir="$RESOLVED_RUN_DIR"

    hdr "Cleaning run: $task"
    warn "This removes the run directory: $run_dir"
    warn "Changes made to original repos are NOT reverted — use git/SmartGit to revert manually."
    read -rp "Continue? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

    rm -rf "$run_dir"
    ok "Removed: $run_dir"
}

# ── record cost into contract ─────────────────────────────────────────────────
# Requires load_contract to have been called first (sets REPOS_COUNT, REPO_N_PATH, etc.)
_record_cost() {
    local task="$1"
    local run_dir="$2"
    python3 - "$task" "$run_dir" "$CONTRACTS_DIR" <<'PYEOF' 2>/dev/null
import json, os, sys, yaml

task, run_dir, contracts_dir = sys.argv[1:]

PRICING = {
    'claude-opus-4':   {'input': 15.0,  'cache_create': 18.75, 'cache_read': 1.50,  'output': 75.0},
    'claude-sonnet-4': {'input':  3.0,  'cache_create':  3.75, 'cache_read': 0.30,  'output': 15.0},
    'claude-haiku-4':  {'input':  0.8,  'cache_create':  1.00, 'cache_read': 0.08,  'output':  4.0},
    'claude-opus-3':   {'input': 15.0,  'cache_create': 18.75, 'cache_read': 1.50,  'output': 75.0},
    'claude-sonnet-3': {'input':  3.0,  'cache_create':  3.75, 'cache_read': 0.30,  'output': 15.0},
    'claude-haiku-3':  {'input':  0.25, 'cache_create':  0.30, 'cache_read': 0.03,  'output':  1.25},
}

def get_pricing(model):
    m = (model or '').lower()
    for key in sorted(PRICING, key=len, reverse=True):
        if key in m:
            return PRICING[key]
    return PRICING['claude-sonnet-4']

def path_to_project_key(path):
    return path.replace('/', '-').replace('.', '-')

repos_count = int(os.environ.get('REPOS_COUNT', 0))
workspace_root = os.environ.get('WORKSPACE_ROOT', '')
total = {'input': 0, 'cache_create': 0, 'cache_read': 0, 'output': 0, 'cost': 0.0}
models_seen = set()

search_paths = []
for i in range(repos_count):
    path    = os.environ[f'REPO_{i}_PATH']
    alias   = os.environ[f'REPO_{i}_ALIAS']
    repo_abs = f"{workspace_root}/{path}"
    search_paths.append(repo_abs)
    search_paths.append(os.path.join(run_dir, alias, 'workdir'))

for search_path in search_paths:
    proj_key = path_to_project_key(search_path)
    proj_dir = os.path.expanduser(f'~/.claude/projects/{proj_key}')
    if not os.path.isdir(proj_dir):
        continue
    jsonl_files = [f for f in os.listdir(proj_dir) if f.endswith('.jsonl')]
    if not jsonl_files:
        continue
    latest = max(jsonl_files, key=lambda f: os.path.getmtime(os.path.join(proj_dir, f)))
    with open(os.path.join(proj_dir, latest)) as f:
        for line in f:
            try:
                msg = json.loads(line).get('message')
                if not isinstance(msg, dict): continue
                usage = msg.get('usage')
                if not isinstance(usage, dict): continue
                model = msg.get('model', '')
                if model: models_seen.add(model)
                p = get_pricing(model)
                inp, cc, cr, out = (
                    usage.get('input_tokens', 0),
                    usage.get('cache_creation_input_tokens', 0),
                    usage.get('cache_read_input_tokens', 0),
                    usage.get('output_tokens', 0),
                )
                total['input']        += inp
                total['cache_create'] += cc
                total['cache_read']   += cr
                total['output']       += out
                total['cost'] += (
                    inp * p['input']        / 1_000_000 +
                    cc  * p['cache_create'] / 1_000_000 +
                    cr  * p['cache_read']   / 1_000_000 +
                    out * p['output']       / 1_000_000
                )
            except Exception:
                pass

if total['output'] == 0:
    sys.exit(0)

import re as _re
parent = _re.sub(r'-F\d+$', '', task)
contract_path = os.path.join(contracts_dir, parent, f'{task}.yaml')
if not os.path.exists(contract_path):
    contract_path = os.path.join(contracts_dir, f'{task}.yaml')
if os.path.exists(contract_path):
    with open(contract_path) as f:
        contract = yaml.safe_load(f) or {}
    total_tok = sum(total[k] for k in ('input', 'cache_create', 'cache_read', 'output'))
    contract['cost'] = {
        'input_tokens':        total['input'],
        'cache_create_tokens': total['cache_create'],
        'cache_read_tokens':   total['cache_read'],
        'output_tokens':       total['output'],
        'total_tokens':        total_tok,
        'estimated_usd':       round(total['cost'], 4),
        'model':               ', '.join(sorted(models_seen)) if models_seen else 'unknown',
    }
    with open(contract_path, 'w') as f:
        yaml.dump(contract, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

total_tok = sum(total[k] for k in ('input', 'cache_create', 'cache_read', 'output'))
print(f"${total['cost']:.4f}  ({total_tok:,} tokens: {total['input']:,} in / {total['output']:,} out / {total['cache_read']:,} cache-read / {total['cache_create']:,} cache-write)")
PYEOF
}

# ── status ────────────────────────────────────────────────────────────────────
cmd_status() {
    local task="$1"
    resolve_run_dir "$task"
    local run_dir="$RESOLVED_RUN_DIR"

    load_contract "$task"

    hdr "Status: $task — $TASK_TITLE"
    echo ""

    yield_repo() {
        local repo_abs="$WORKSPACE_ROOT/$REPO_PATH"
        echo -e "  ${BOLD}[$ALIAS]${NC} ($ROLE, $REPO_TYPE)"

        if [[ -d "$repo_abs" ]]; then
            local changed
            changed=$(cd "$repo_abs" && git diff --name-only 2>/dev/null)
            if [[ -n "$changed" ]]; then
                local n; n=$(echo "$changed" | wc -l | tr -d ' ')
                ok "    $n file(s) modified:"
                echo "$changed" | while IFS= read -r f; do echo "         $f"; done
            else
                info "    working tree: clean"
            fi
        else
            warn "    repo not found: $repo_abs"
        fi
        echo ""
    }
    for_each_repo

    # Artifacts
    local report="$run_dir/report.md"
    local review="$run_dir/reviews/REVIEW-$task.yaml"
    local workspace="$run_dir/$task.code-workspace"
    local prompt="$run_dir/agent-prompt-current.md"

    echo -e "  ${BOLD}[artifacts]${NC}"
    [[ -f "$workspace" ]] && ok "    workspace:    $workspace"    || warn "    workspace:    missing"
    [[ -f "$prompt" ]]    && ok "    agent-prompt: $prompt"       || warn "    agent-prompt: missing"
    [[ -f "$report" ]]    && ok "    report:       $report"       || warn "    report:       not written yet"
    [[ -f "$review" ]]    && ok "    review:       $review"       || warn "    review:       not written yet"
    echo ""

    # Cost (extracted from Claude Code session JSONL)
    hdr "Cost"
    local cost_out
    cost_out=$(_record_cost "$task" "$run_dir") || cost_out="(cost extraction failed)"
    ok "$cost_out"
    echo ""
}

# ── review ────────────────────────────────────────────────────────────────────
cmd_review() {
    local task="$1"
    resolve_run_dir "$task"
    local run_dir="$RESOLVED_RUN_DIR"
    mkdir -p "$run_dir/reviews"
    local review_file="$run_dir/reviews/REVIEW-$task.yaml"

    load_contract "$task"

    hdr "Review: $task"

    {
        echo "id: REVIEW-$task"
        echo "task_id: $task"
        echo "decision: pending   # approved | needs_changes"
        echo ""
        echo "notes: |"
        echo "  # Írd ide mi nem tetszik — szabadon, bármilyen formában."
        echo "  # Ha végzett:"
        echo "  #   decision: approved       → SmartGit → commit → push → CR"
        echo "  #   decision: needs_changes  → Ctrl+Shift+P → 'agentor: ▶ Next Iteration'"
        echo ""
        echo "# --- Optional cost controls ---"
        echo "# scope: src/components/screens/QueryTemplates   # narrow paths to reduce cache tokens (~50% savings)"
        echo "# model: haiku                                   # use Haiku for simple fixes (~70% savings)"
        echo "# include_reference: false                       # skip reference repos (set true to keep)"

    } > "$review_file"

    ok "Review file → $review_file"

    local cost_task="$task"
    local latest_fn
    latest_fn=$(ls "$CONTRACTS_DIR/$task/${task}-F"*.yaml 2>/dev/null | sort -V | tail -1) || true
    if [[ -n "$latest_fn" ]]; then
        cost_task=$(basename "$latest_fn" .yaml)
    fi

    local cost_out
    cost_out=$(_record_cost "$cost_task" "$run_dir") || true
    [[ -n "$cost_out" ]] && ok "Cost recorded into $cost_task: $cost_out"

    echo ""
    info "Next steps:"
    echo "  Ctrl+Shift+G              → side-by-side diff per file (SmartGit vagy VS Code)"
    echo "  Edit REVIEW-$task.yaml   → írd be mi nem tetszik a notes mezőbe"
    echo "  decision: approved        → SmartGit → commit → push → CR"
    echo "  decision: needs_changes   → Ctrl+Shift+P → 'agentor: ▶ Next Iteration'"
    echo ""

    local code_cmd=""
    command -v code     &>/dev/null && code_cmd="code"
    command -v code.exe &>/dev/null && code_cmd="code.exe"
    if [[ -n "$code_cmd" ]]; then
        "$code_cmd" "$review_file" &
    fi
}

# ── next ──────────────────────────────────────────────────────────────────────
cmd_next() {
    local task="$1"
    resolve_run_dir "$task"
    local run_dir="$RESOLVED_RUN_DIR"
    mkdir -p "$run_dir/reviews"
    local review_file="$run_dir/reviews/REVIEW-$task.yaml"

    # Use the latest F-numbered review file if it has notes, instead of the base one
    local latest_f
    latest_f=$(ls "$run_dir/reviews/REVIEW-$task-F"*.yaml 2>/dev/null | sort -V | tail -1) || true
    if [[ -n "$latest_f" ]]; then
        review_file="$latest_f"
    fi

    [[ -f "$review_file" ]] || { err "Review file not found: $review_file"; exit 1; }

    load_contract "$task"

    hdr "Next iteration: $task"

    local new_task
    new_task=$(python3 - "$task" "$review_file" "$CONTRACTS_DIR" <<'PYEOF'
import sys, yaml, os

task, review_path, contracts_dir = sys.argv[1:]

with open(review_path) as f:
    review = yaml.safe_load(f)

notes = str(review.get('notes') or '').strip()
notes_lines = [l for l in notes.splitlines() if not l.strip().startswith('#')]
notes = '\n'.join(notes_lines).strip()

if not notes:
    print("NO_NOTES", end="")
    sys.exit(0)

suffix_num = 1
folder = os.path.join(contracts_dir, task)
os.makedirs(folder, exist_ok=True)
while os.path.exists(os.path.join(folder, f"{task}-F{suffix_num}.yaml")):
    suffix_num += 1
new_id = f"{task}-F{suffix_num}"

orig_path = os.path.join(contracts_dir, task, f"{task}.yaml")
if not os.path.exists(orig_path):
    orig_path = os.path.join(contracts_dir, f"{task}.yaml")
with open(orig_path) as f:
    orig = yaml.safe_load(f)

scope_override = str(review.get('scope') or '').strip()
model_override = str(review.get('model') or '').strip()
include_reference = str(review.get('include_reference', '')).strip().lower()
keep_reference = include_reference in ('true', 'yes', '1')

new_repos = []
for r in orig.get('repos', []):
    repo = dict(r)
    if repo.get('role') == 'reference' and not keep_reference:
        continue  # skip reference repos in followups — saves ~40% cache tokens
    if scope_override and repo.get('role', 'primary') == 'primary':
        scope_paths = [p.strip() for p in scope_override.replace(',', '\n').splitlines() if p.strip()]
        repo['paths'] = scope_paths
    new_repos.append(repo)

goal = (
    f"Followup for {task}.\n\n"
    f"Review notes:\n{notes}\n\n"
    f"Original goal: {str(orig.get('goal', '')).strip()}"
)

new_contract = {
    'id': new_id,
    'title': f"Followup: {orig.get('title', task)}",
    'repos': new_repos,
    'goal': goal,
    'constraints': orig.get('constraints', []),
    'acceptance_criteria': orig.get('acceptance_criteria', []),
    'agent': orig.get('agent', {'tool': 'claude', 'mode': 'direct'}),
}
if model_override:
    new_contract['model'] = model_override

out_path = os.path.join(folder, f"{new_id}.yaml")
with open(out_path, 'w') as f:
    yaml.dump(new_contract, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

print(new_id, end="")
PYEOF
)

    if [[ "$new_task" == "NO_NOTES" ]]; then
        warn "A notes mező üres a review fájlban."
        info "Írd be mi nem tetszik a $(basename "$review_file") notes mezőjébe, majd futtasd újra."
        exit 0
    fi

    ok "Contract → $CONTRACTS_DIR/$new_task"

    cmd_run "$new_task"

}

# ── usage ─────────────────────────────────────────────────────────────────────
usage() {
    cat <<EOF

${BOLD}agentor.sh${NC} — multi-repo AI task workflow

  ${CYAN}./agentor.sh run     TASK-ID${NC}    Set up run dir + generate agent-prompt-current.md
  ${CYAN}./agentor.sh review  TASK-ID${NC}    Generate review file with current git diff
  ${CYAN}./agentor.sh next    TASK-ID${NC}    Next iteration: review → new contract → new prompt
  ${CYAN}./agentor.sh status  TASK-ID${NC}    Show task state + git changes + cost
  ${CYAN}./agentor.sh clean   TASK-ID${NC}    Remove run directory (repos unchanged)

${BOLD}Iteration cycle:${NC}
  1. ./agentor.sh run    TASK-001   → agent-prompt-current.md
     Paste prompt into Claude Code
  2. Claude finishes → ./agentor.sh review TASK-001
     Fill notes + set decision in REVIEW-TASK-001.yaml
     Ctrl+Shift+G → side-by-side diff
  3a. decision: approved      → SmartGit → commit → push → CR
  3b. decision: needs_changes → Ctrl+Shift+P → Tasks → ▶ Next Iteration
      → new agent-prompt-current.md ready; Reload Window + paste

EOF
}

# ── main ──────────────────────────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
    usage
    exit 1
fi

CMD="$1"
TASK="$2"

case "$CMD" in
    run)    cmd_run    "$TASK" ;;
    review) cmd_review "$TASK" ;;
    next)   cmd_next   "$TASK" ;;
    status) cmd_status "$TASK" ;;
    clean)  cmd_clean  "$TASK" ;;
    *)      err "Unknown command: $CMD"; usage; exit 1 ;;
esac
