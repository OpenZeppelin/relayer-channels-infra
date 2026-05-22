import { defineCommand } from 'citty';
import { exitWithUsageError } from '../utils/errors.js';

const BASH_COMPLETION = `# oz-relayer bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(oz-relayer completions bash)"

_oz_relayer_completions() {
    local cur prev commands subcommands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="profile relayer tx signer health agent-docs completions"

    case "\${COMP_WORDS[1]}" in
        profile)
            subcommands="init list show use delete path"
            ;;
        relayer)
            subcommands="list show status balance pause resume"
            ;;
        tx)
            subcommands="send status list show cancel cancel-all"
            ;;
        signer)
            subcommands="list show"
            ;;
        completions)
            subcommands="bash zsh fish"
            ;;
        *)
            subcommands=""
            ;;
    esac

    if [[ \${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
    elif [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( \$(compgen -W "\${subcommands}" -- "\${cur}") )
    elif [[ "\${cur}" == -* ]]; then
        local opts="--profile --url --api-key --json --no-input --help"
        case "\${COMP_WORDS[1]}" in
            tx)
                case "\${COMP_WORDS[2]}" in
                    send)
                        opts="\${opts} --relayer --to --value --data --gas-limit --wait --timeout"
                        ;;
                    list)
                        opts="\${opts} --relayer --status --page --per-page"
                        ;;
                    *)
                        opts="\${opts} --relayer"
                        ;;
                esac
                ;;
            relayer|signer)
                case "\${COMP_WORDS[2]}" in
                    list)
                        opts="\${opts} --page --per-page"
                        ;;
                esac
                ;;
        esac
        COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
    fi
}

complete -F _oz_relayer_completions oz-relayer
`;

const ZSH_COMPLETION = `#compdef oz-relayer
# oz-relayer zsh completion
# Add to ~/.zshrc:
#   eval "$(oz-relayer completions zsh)"

_oz_relayer() {
    local -a commands subcommands opts

    commands=(
        'profile:Manage connection profiles'
        'relayer:Relayer operations'
        'tx:Transaction operations'
        'signer:Signer management'
        'health:Check relayer service health'
        'agent-docs:Output documentation for AI agents'
        'completions:Generate shell completions'
    )

    _arguments -C \\
        '1: :->command' \\
        '2: :->subcommand' \\
        '*: :->args'

    case "\$state" in
        command)
            _describe 'command' commands
            ;;
        subcommand)
            case "\$words[2]" in
                profile)
                    subcommands=(
                        'init:Create a new profile'
                        'list:List all profiles'
                        'show:Show profile details'
                        'use:Set default profile'
                        'delete:Delete a profile'
                        'path:Show config file paths'
                    )
                    ;;
                relayer)
                    subcommands=(
                        'list:List all relayers'
                        'show:Show relayer details'
                        'status:Get relayer status'
                        'balance:Get relayer balance'
                        'pause:Pause a relayer'
                        'resume:Resume a relayer'
                    )
                    ;;
                tx)
                    subcommands=(
                        'send:Send a transaction'
                        'status:Get transaction status'
                        'list:List transactions'
                        'show:Show transaction details'
                        'cancel:Cancel a transaction'
                        'cancel-all:Cancel all pending transactions'
                    )
                    ;;
                signer)
                    subcommands=(
                        'list:List all signers'
                        'show:Show signer details'
                    )
                    ;;
                completions)
                    subcommands=(
                        'bash:Generate bash completions'
                        'zsh:Generate zsh completions'
                        'fish:Generate fish completions'
                    )
                    ;;
            esac
            _describe 'subcommand' subcommands
            ;;
        args)
            opts=(
                '-p[Profile to use]:profile:'
                '--profile[Profile to use]:profile:'
                '--url[Override relayer URL]:url:'
                '--api-key[Override API key]:key:'
                '--json[Output as JSON]'
                '--no-input[Disable interactive prompts]'
                '-h[Show help]'
                '--help[Show help]'
            )
            _arguments "\$opts[@]"
            ;;
    esac
}

compdef _oz_relayer oz-relayer
`;

const FISH_COMPLETION = `# oz-relayer fish completion
# Add to ~/.config/fish/completions/oz-relayer.fish:
#   oz-relayer completions fish > ~/.config/fish/completions/oz-relayer.fish

# Disable file completions
complete -c oz-relayer -f

# Main commands
complete -c oz-relayer -n "__fish_use_subcommand" -a profile -d "Manage connection profiles"
complete -c oz-relayer -n "__fish_use_subcommand" -a relayer -d "Relayer operations"
complete -c oz-relayer -n "__fish_use_subcommand" -a tx -d "Transaction operations"
complete -c oz-relayer -n "__fish_use_subcommand" -a signer -d "Signer management"
complete -c oz-relayer -n "__fish_use_subcommand" -a health -d "Check relayer service health"
complete -c oz-relayer -n "__fish_use_subcommand" -a agent-docs -d "Output documentation for AI agents"
complete -c oz-relayer -n "__fish_use_subcommand" -a completions -d "Generate shell completions"

# profile subcommands
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a init -d "Create a new profile"
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a list -d "List all profiles"
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a show -d "Show profile details"
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a use -d "Set default profile"
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a delete -d "Delete a profile"
complete -c oz-relayer -n "__fish_seen_subcommand_from profile" -a path -d "Show config file paths"

# relayer subcommands
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a list -d "List all relayers"
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a show -d "Show relayer details"
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a status -d "Get relayer status"
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a balance -d "Get relayer balance"
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a pause -d "Pause a relayer"
complete -c oz-relayer -n "__fish_seen_subcommand_from relayer" -a resume -d "Resume a relayer"

# tx subcommands
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a send -d "Send a transaction"
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a status -d "Get transaction status"
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a list -d "List transactions"
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a show -d "Show transaction details"
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a cancel -d "Cancel a transaction"
complete -c oz-relayer -n "__fish_seen_subcommand_from tx" -a cancel-all -d "Cancel all pending"

# signer subcommands
complete -c oz-relayer -n "__fish_seen_subcommand_from signer" -a list -d "List all signers"
complete -c oz-relayer -n "__fish_seen_subcommand_from signer" -a show -d "Show signer details"

# completions subcommands
complete -c oz-relayer -n "__fish_seen_subcommand_from completions" -a bash -d "Generate bash completions"
complete -c oz-relayer -n "__fish_seen_subcommand_from completions" -a zsh -d "Generate zsh completions"
complete -c oz-relayer -n "__fish_seen_subcommand_from completions" -a fish -d "Generate fish completions"

# Global options
complete -c oz-relayer -s p -l profile -d "Profile to use"
complete -c oz-relayer -l url -d "Override relayer URL"
complete -c oz-relayer -l api-key -d "Override API key"
complete -c oz-relayer -l json -d "Output as JSON"
complete -c oz-relayer -l no-input -d "Disable interactive prompts"
complete -c oz-relayer -s h -l help -d "Show help"
`;

export const completionsCommand = defineCommand({
  meta: {
    name: 'completions',
    description: 'Generate shell completions',
  },
  args: {
    shell: {
      type: 'positional',
      description: 'Shell type (bash, zsh, fish)',
      required: false,
    },
  },
  run({ args }) {
    const shell = args.shell?.toLowerCase();

    if (!shell) {
      console.log(`Generate shell completions for oz-relayer.

Usage:
  oz-relayer completions <shell>

Shells:
  bash    Bash completion script
  zsh     Zsh completion script
  fish    Fish completion script

Setup:

  Bash (add to ~/.bashrc):
    eval "$(oz-relayer completions bash)"

  Zsh (add to ~/.zshrc):
    eval "$(oz-relayer completions zsh)"

  Fish (save to completions directory):
    oz-relayer completions fish > ~/.config/fish/completions/oz-relayer.fish
`);
      return;
    }

    switch (shell) {
      case 'bash':
        console.log(BASH_COMPLETION);
        break;
      case 'zsh':
        console.log(ZSH_COMPLETION);
        break;
      case 'fish':
        console.log(FISH_COMPLETION);
        break;
      default:
        exitWithUsageError(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
    }
  },
});
