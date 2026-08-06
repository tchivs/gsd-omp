'use strict';

// 简体中文消息（gsd-omp 主机 CLI 与 EoS 引导阶段）。
// 键名与 en.cjs 一一对应；保持扁平点分命名空间。

module.exports = {
  'cli.usage': '用法：gsd-omp [install|update|uninstall|doctor|descriptor] [--root <路径>] [--force] [--json]',

  'cli.error.unknownCommand': '未知命令：{command}',
  'cli.error.unknownArgument': '未知参数：{arg}',
  'cli.error.rootRequiresPath': '--root 需要一个路径',
  'cli.error.cannotReadManifest': '无法读取 {path}：{message}',
  'cli.error.unsupportedCore': 'gsd-omp 需要 @opengsd/gsd-core >=1.8.0；当前版本 {version}',
  'cli.error.refusingOverwrite': '拒绝覆盖未托管或已本地修改的文件：{path}（加 --force 可替换 GSD 托管的投影文件）',
  'cli.error.updateCheckFailed': 'gsd-omp：无法检查更新（GitHub API 不可达或没有 release）',
  'cli.error.updateFailed': 'gsd-omp：更新失败 —— npm install 未正常退出；请手动执行 tarball URL 安装后再运行 `gsd-omp install`',
  'cli.error.updateProjectionFailed': 'gsd-omp：更新已安装新包，但无法重新投影 OMP 文件；请手动运行 `gsd-omp install`',

  'eos.error.unexpectedProfile': 'gsd-omp：EoS 协商得到 {profile}，应为 programmatic-cli',
  'eos.error.unsupportedProtocol': 'gsd-omp：不支持的 EoS 协议版本 {version}',
};
