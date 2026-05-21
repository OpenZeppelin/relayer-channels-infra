import { defineCommand } from 'citty';
import { exitWithUsageError } from '../utils/errors.js';

const BASH_COMPLETION = `# oz-channels bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(oz-channels completions bash)"

_oz_channels_completions() {
    local cur prev commands subcommands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="profile submit channels fee health smoke bootstrap agent-docs completions"

    case "\${COMP_WORDS[1]}" in
        profile)
            subcommands="init list show use delete path"
            ;;
        submit)
            subcommands="xdr func-auth"
            ;;
        channels)
            subcommands="list set add remove"
            ;;
        fee)
            subcommands="usage limit set-limit delete-limit"
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
        local opts="--profile --url --api-key --plugin-id --admin-secret --json --no-input --help"
        case "\${COMP_WORDS[1]}" in
            submit)
                case "\${COMP_WORDS[2]}" in
                    xdr)
                        opts="\${opts} --file --wait --timeout"
                        ;;
                    func-auth)
                        opts="\${opts} --func --auth --wait --timeout"
                        ;;
                esac
                ;;
            smoke)
                opts="\${opts} --test-id --list --concurrency --debug"
                ;;
            bootstrap)
                opts="\${opts} --total --funding-relayer --starting-balance --prefix --padding --start --delay-ms --fix --dry-run"
                ;;
        esac
        COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
    fi
}

complete -F _oz_channels_completions oz-channels
`;

const ZSH_COMPLETION = `# oz-channels zsh completion
# Add to ~/.zshrc (AFTER compinit):
#   eval "$(oz-channels completions zsh)"

_oz_channels() {
        local curcontext="\$curcontext" state line
        typeset -A opt_args

        local -a commands=(
            'profile:Manage connection profiles'
            'submit:Submit transactions'
            'channels:Manage channel accounts'
            'fee:Fee management'
            'health:Check service health'
            'smoke:Run smoke tests'
            'bootstrap:Provision channel accounts'
            'agent-docs:Output documentation for AI agents'
            'completions:Generate shell completions'
        )

        _arguments -C \\
            '(-p --profile)'{-p,--profile}'[Profile to use]:profile:' \\
            '--url[Override channels URL]:url:' \\
            '--api-key[Override API key]:key:' \\
            '--plugin-id[Override plugin ID]:id:' \\
            '--admin-secret[Override admin secret]:secret:' \\
            '--json[Output as JSON]' \\
            '--no-input[Disable interactive prompts]' \\
            '(-h --help)'{-h,--help}'[Show help]' \\
            '1: :->command' \\
            '2: :->subcommand' \\
            '*::arg:->args' && return

        case "\$state" in
            command)
                _describe -t commands 'oz-channels command' commands
                ;;
            subcommand)
                case "\$line[1]" in
                    profile)
                        local -a profile_cmds=(
                            'init:Create a new profile'
                            'list:List all profiles'
                            'show:Show profile details'
                            'use:Set default profile'
                            'delete:Delete a profile'
                            'path:Show config file paths'
                        )
                        _describe -t commands 'profile command' profile_cmds
                        ;;
                    submit)
                        local -a submit_cmds=(
                            'xdr:Submit signed XDR transaction'
                            'func-auth:Submit Soroban with func and auth'
                        )
                        _describe -t commands 'submit command' submit_cmds
                        ;;
                    channels)
                        local -a channels_cmds=(
                            'list:List channel accounts'
                            'set:Replace all channel accounts'
                            'add:Add channel account'
                            'remove:Remove channel account'
                        )
                        _describe -t commands 'channels command' channels_cmds
                        ;;
                    fee)
                        local -a fee_cmds=(
                            'usage:Get fee usage'
                            'limit:Get fee limit'
                            'set-limit:Set fee limit'
                            'delete-limit:Remove fee limit'
                        )
                        _describe -t commands 'fee command' fee_cmds
                        ;;
                    smoke)
                        local -a smoke_cmds=(
                            'setup:Deploy smoke contract'
                            'run:Run smoke tests'
                        )
                        _describe -t commands 'smoke command' smoke_cmds
                        ;;
                    completions)
                        local -a comp_cmds=(
                            'bash:Generate bash completions'
                            'zsh:Generate zsh completions'
                            'fish:Generate fish completions'
                        )
                        _describe -t commands 'completions command' comp_cmds
                        ;;
                esac
                ;;
        esac
    }
compdef _oz_channels oz-channels
`;

const FISH_COMPLETION = `# oz-channels fish completion
# Add to ~/.config/fish/completions/oz-channels.fish:
#   oz-channels completions fish > ~/.config/fish/completions/oz-channels.fish

# Disable file completions
complete -c oz-channels -f

# Main commands
complete -c oz-channels -n "__fish_use_subcommand" -a profile -d "Manage connection profiles"
complete -c oz-channels -n "__fish_use_subcommand" -a submit -d "Submit transactions"
complete -c oz-channels -n "__fish_use_subcommand" -a channels -d "Manage channel accounts"
complete -c oz-channels -n "__fish_use_subcommand" -a fee -d "Fee management"
complete -c oz-channels -n "__fish_use_subcommand" -a health -d "Check service health"
complete -c oz-channels -n "__fish_use_subcommand" -a smoke -d "Run smoke tests"
complete -c oz-channels -n "__fish_use_subcommand" -a bootstrap -d "Provision channel accounts"
complete -c oz-channels -n "__fish_use_subcommand" -a agent-docs -d "Output documentation for AI agents"
complete -c oz-channels -n "__fish_use_subcommand" -a completions -d "Generate shell completions"

# profile subcommands
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a init -d "Create a new profile"
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a list -d "List all profiles"
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a show -d "Show profile details"
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a use -d "Set default profile"
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a delete -d "Delete a profile"
complete -c oz-channels -n "__fish_seen_subcommand_from profile" -a path -d "Show config file paths"

# submit subcommands
complete -c oz-channels -n "__fish_seen_subcommand_from submit" -a xdr -d "Submit signed XDR"
complete -c oz-channels -n "__fish_seen_subcommand_from submit" -a func-auth -d "Submit Soroban with func and auth"

# channels subcommands
complete -c oz-channels -n "__fish_seen_subcommand_from channels" -a list -d "List channel accounts"
complete -c oz-channels -n "__fish_seen_subcommand_from channels" -a set -d "Replace all channel accounts"
complete -c oz-channels -n "__fish_seen_subcommand_from channels" -a add -d "Add channel account"
complete -c oz-channels -n "__fish_seen_subcommand_from channels" -a remove -d "Remove channel account"

# fee subcommands
complete -c oz-channels -n "__fish_seen_subcommand_from fee" -a usage -d "Get fee usage"
complete -c oz-channels -n "__fish_seen_subcommand_from fee" -a limit -d "Get fee limit"
complete -c oz-channels -n "__fish_seen_subcommand_from fee" -a set-limit -d "Set fee limit"
complete -c oz-channels -n "__fish_seen_subcommand_from fee" -a delete-limit -d "Remove fee limit"

# completions subcommands
complete -c oz-channels -n "__fish_seen_subcommand_from completions" -a bash -d "Generate bash completions"
complete -c oz-channels -n "__fish_seen_subcommand_from completions" -a zsh -d "Generate zsh completions"
complete -c oz-channels -n "__fish_seen_subcommand_from completions" -a fish -d "Generate fish completions"

# Global options
complete -c oz-channels -s p -l profile -d "Profile to use"
complete -c oz-channels -l url -d "Override channels URL"
complete -c oz-channels -l api-key -d "Override API key"
complete -c oz-channels -l plugin-id -d "Override plugin ID"
complete -c oz-channels -l admin-secret -d "Override admin secret"
complete -c oz-channels -l json -d "Output as JSON"
complete -c oz-channels -l no-input -d "Disable interactive prompts"
complete -c oz-channels -s h -l help -d "Show help"
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
      console.log(`Generate shell completions for oz-channels.

Usage:
  oz-channels completions <shell>

Shells:
  bash    Bash completion script
  zsh     Zsh completion script
  fish    Fish completion script

Setup:

  Bash (add to ~/.bashrc):
    eval "$(oz-channels completions bash)"

  Zsh (add to ~/.zshrc AFTER compinit):
    autoload -Uz compinit && compinit
    eval "$(oz-channels completions zsh)"

  Fish (save to completions directory):
    oz-channels completions fish > ~/.config/fish/completions/oz-channels.fish
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
