# GSD for Oh My Pi

[![Release](https://img.shields.io/github/v/release/tchivs/gsd-omp?logo=github&label=release)](https://github.com/tchivs/gsd-omp/releases)
[![License: MIT](https://img.shields.io/github/license/tchivs/gsd-omp?color=blue)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![GSD Core](https://img.shields.io/badge/gsd--core-%E2%89%A51.7.0-0066cc)](https://github.com/open-gsd/gsd-core)
[![OMP EoS](https://img.shields.io/badge/OMP-EoS%20v1-6c31c4)](#eos-契约)
[![Last Commit](https://img.shields.io/github/last-commit/tchivs/gsd-omp?logo=git&logoColor=white)](https://github.com/tchivs/gsd-omp/commits)
[![Stars](https://img.shields.io/github/stars/tchivs/gsd-omp?style=social)](https://github.com/tchivs/gsd-omp/stargazers)

[English](./README.md) · **简体中文**

`gsd-omp` 是一个独立维护的 Oh My Pi 宿主插件，面向 [GSD 嵌入式编排系统](https://github.com/open-gsd/gsd-core/blob/next/docs/explanation/embeddable-orchestration-system.md)。它通过公共 Host-Integration SDK 的协议版本 1，将 OMP 原生的扩展、命令、事件、任务与文件系统接口绑定到 GSD。

本项目为第三方软件，未由 OpenGSD 背书、审查或维护。

## 环境要求

- Node.js 22 或更高版本
- 启用原生 ExtensionAPI 的 Oh My Pi
- GSD Core 1.7.0 或更高版本；作为本包依赖自动安装

## 安装

全局安装已发布的插件，随后将其托管的扩展、agents 与 skills 投影到 OMP：

```bash
npm install --global github:tchivs/gsd-omp#v1.0.0
gsd-omp install
```

支持 `PI_CODING_AGENT_DIR` 环境变量。未设置时，文件安装到 `~/.omp/agent`。

安装完成后重启 OMP，即可使用：

```text
/gsd-next
/gsd-progress
/gsd-plan-phase 1
/gsd <gsd-tools family> <subcommand> [args]
```

插件还会注册 `gsd_invoke` 工具，用于以结构化方式访问公共 `gsd-tools` CLI。

## 校验

```bash
gsd-omp doctor
```

健康的安装会报告 `"ok": true`、EoS profile 为 `programmatic-cli`、协议版本为 `1`。

查看完整的 EoS 声明：

```bash
gsd-omp descriptor
```

## 升级

```bash
gsd-omp uninstall
npm install --global github:tchivs/gsd-omp#v1.0.0
gsd-omp install
```

安装器会拒绝覆盖未托管或已被本地修改的投影文件。仅当确实要替换之前由 GSD 托管的 OMP 文件时，才使用 `--force`：

```bash
gsd-omp install --force
```

## 卸载

先移除托管的 OMP 产物，再卸载拥有安装器的本包：

```bash
gsd-omp uninstall
npm uninstall --global gsd-omp
```

被修改的托管文件会被保留并报告。仅当确实要删除它们时，才传入 `--force`。

## 语言环境

宿主 CLI（`gsd-omp install|uninstall|doctor|descriptor`）与 EoS 引导阶段的消息遵循 POSIX 环境变量，按以下顺序解析：

1. `GSD_OMP_LOCALE` —— 显式覆盖，优先级最高
2. `LC_ALL`
3. `LC_MESSAGES`
4. `LANG`

任何小写形式以 `zh` 开头的取值（如 `zh_CN.UTF-8`、`zh_TW`）会选中简体中文；其余取值回落到英文。未知键名回落到英文，未提供的占位符会原样保留。

```bash
# 无论 shell 语言环境如何，强制输出中文
GSD_OMP_LOCALE=zh_CN.UTF-8 gsd-omp doctor
```

会话内的 OMP 扩展（`/gsd-*` 命令、状态组件、续接提示）走另一条本地化路径，通过项目 `.planning/config.json` 中的 `response_language` 字段控制。当扩展首次加载一个未设置该字段的 GSD 项目时，会弹出一个一次性的 `简体中文 / English` 选择器。

支持的语言：`en`（默认）、`zh-CN`。

## EoS 契约

| 字段 | 取值 |
|---|---|
| Protocol | `1` |
| Profile | `programmatic-cli` |
| Interface points | `command`, `dispatch`, `model`, `hooks`, `state`, `artifact` |
| `embeddingMode` | `imperative` |
| `commandSurface` | `slash-programmatic` |
| `dispatch` | 命名分发、嵌套至深度 2、后台、完整子代理工具集 |
| `modelMode` | `passive` —— 由 OMP 拥有模型路由 |
| `hookBus` | `host` —— 由 OMP 拥有生命周期事件 |
| `stateIO` | `filesystem` |
| `transport` | `native-extension` |
| `runtime` | `bun` |

插件在加载时导入 GSD 的带版本号的 Host-Integration SDK 入口，完成 EoS 握手协商，再通过本包公共的 `gsd-tools` 可执行文件调用 GSD。它不会 patch 或修改 `gsd-core` 源码。

## 托管文件

安装器会写入：

- `extensions/gsd-omp.ts`
- 投影后的 `agents/gsd-*.md`
- 投影后的 `skills/gsd-*/SKILL.md`
- `.gsd-omp-manifest.json`（含所有权哈希）

清单文件让升级与卸载具备所有权感知能力。安装后被修改的文件在未加 `--force` 时不会被覆盖或删除。

## 开发

```bash
npm install
npm run lint
npm test
```

可在不触碰用户 OMP profile 的前提下，执行一次本地隔离安装：

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" node bin/gsd-omp.cjs install
```

## 版权归属

OMP 扩展源自 `open-gsd/gsd-core` 中采用 MIT 许可的 pi 参考宿主，并被改造为本独立维护的 EoS 插件。上游 Open GSD 的版权声明保留在 `LICENSE` 中。

## 许可证

MIT
