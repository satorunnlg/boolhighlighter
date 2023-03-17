# Bool Highlighter

Bool Highlighterは、Visual Studio Codeの拡張機能です。デバッグ中にブール型の変数の値に基づいて、変数名の背景色を変更します。Trueの場合は黄色、Falseの場合は青色になります。

## 使用方法

1. 拡張機能をインストールして有効化します。
2. デバッグセッションを開始します。
3. ブール型の変数が自動的にハイライトされます。

## 設定

以下の設定を変更することで、拡張機能の動作をカスタマイズできます。

- `boolhighlighter.yellowColor`: Trueの変数の背景色を設定します（デフォルトは黄色）。
- `boolhighlighter.blueColor`: Falseの変数の背景色を設定します（デフォルトは青色）。
- `boolhighlighter.yellowTextColor`: Trueの変数のテキスト色を設定します（デフォルトは黒色）。
- `boolhighlighter.blueTextColor`: Falseの変数のテキスト色を設定します（デフォルトは白色）。
- `boolhighlighter.updateDelay`: デバッグ開始後にハイライトを更新するまでの遅延時間をミリ秒単位で設定します（デフォルトは500ミリ秒）。
- `boolhighlighter.updateInterval`: デバッグ中に定期的にハイライトを更新する間隔をミリ秒単位で設定します（デフォルトは1000ミリ秒）。

## サポートとフィードバック

もし問題が発生したり、新機能の提案がある場合は、GitHubのリポジトリでIssueを作成してください。貢献やプルリクエストも大歓迎です。

## ライセンス

この拡張機能はMITライセンスで公開されています。詳細については、リポジトリ内の[LICENSE](LICENSE)ファイルをご覧ください。


