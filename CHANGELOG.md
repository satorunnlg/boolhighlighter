# Change Log

All notable changes to the "boolhighlighter" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.5] - 2026-01-03

### Added
- GitHub Actions自動公開ワークフローを追加
- DESIGN.md: プロジェクト設計書を追加
- CLAUDE.md: プロジェクトルールを追加

### Changed
- 全依存パッケージをセキュリティアップデート
- `vscode-debugprotocol` から `@vscode/debugprotocol` に移行（非推奨パッケージの置き換え）
- TypeScriptを4.9.5から5.7.2にアップグレード
- `@types/node`を16.xから20.xにアップグレード
- その他開発依存パッケージを最新の安定版に更新

### Fixed
- 10件のセキュリティ脆弱性を修正（低1件、中6件、高3件）
  - brace-expansion: ReDoS脆弱性
  - braces: リソース消費の脆弱性
  - cross-spawn: ReDoS脆弱性
  - js-yaml: プロトタイプ汚染
  - micromatch: ReDoS脆弱性
  - nanoid: 予測可能な生成結果
  - semver: ReDoS脆弱性
  - serialize-javascript: XSS脆弱性
  - word-wrap: ReDoS脆弱性

## [Unreleased]

- Initial release