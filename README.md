# Bool Highlighter

Bool Highlighterは、Visual Studio Code用の拡張機能です。デバッグセッション中に、ブール型の変数を視覚的に識別するために、TrueとFalseの値に応じてハイライトを適用します。また、選択したブール型変数の値をトグルする機能も提供します。

## 機能

- デバッグセッション中に、ブール型の変数に対してハイライトを適用します。
  - Trueの値には黄色のハイライト
  - Falseの値には青色のハイライト
- 選択したブール型変数の値をトグルするコマンドを提供します。

## 使い方

1. Visual Studio Codeで拡張機能をインストールします。
2. デバッグセッションを開始します。
3. ブール型の変数がTrueまたはFalseの値に応じてハイライトされるのを確認します。
4. トグルしたいブール型変数を選択し、コマンドパレットから`Bool Highlighter: Toggle Boolean Value`を実行します。

## 設定

- `boolhighlighter.yellowColor`: Trueの値に適用される背景色を指定します（デフォルトは`yellow`）。
- `boolhighlighter.blueColor`: Falseの値に適用される背景色を指定します（デフォルトは`blue`）。
- `boolhighlighter.yellowTextColor`: Trueの値に適用されるテキスト色を指定します（デフォルトは`black`）。
- `boolhighlighter.blueTextColor`: Falseの値に適用されるテキスト色を指定します（デフォルトは`white`）。
- `boolhighlighter.updateDelay`: ハイライト更新の遅延時間（ミリ秒）を指定します（デフォルトは`500`）。
- `boolhighlighter.updateInterval`: ハイライト更新の間隔（ミリ秒）を指定します（デフォルトは`1000`）。

## 貢献

バグの報告や機能要望、プルリクエストは大歓迎です！GitHubリポジトリでイシューやプルリクエストを作成してください。


## ライセンス

この拡張機能はMITライセンスで公開されています。詳細については、リポジトリ内の[LICENSE](LICENSE)ファイルをご覧ください。


