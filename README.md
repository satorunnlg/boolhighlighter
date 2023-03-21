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

## Bool値を取りうる変数の種類とハイライト・トグル対応

| 変数の種類               | 説明                                                         | ハイライト対応 | トグル対応 |
|------------------------|------------------------------------------------------------|------------|---------|
| 通常の変数                 | bool値を直接保持する通常の変数です。                                 | 対応       | 対応    |
| 辞書型 (dict)            | キーと値のペアで構成されるデータ構造で、値としてbool値を保持できます。            | 対応       | 非対応    |
| リスト型 (list)          | 順序付けられたデータ構造で、要素としてbool値を保持できます。                     | 対応       | 非対応    |
| タプル型 (tuple)         | 順序付けられたイミュータブルなデータ構造で、要素としてbool値を保持できます。         | 対応       | 非対応  |
| セット型 (set)           | 重複しない要素のコレクションで、要素としてbool値を保持できます。                 | 対応       | 非対応  |
| クラス変数               | クラスに属する変数で、クラスインスタンス間で共有され、bool値を保持できます。         | 非対応       | 非対応    |
| インスタンス変数           | クラスのインスタンスに属する変数で、インスタンスごとに異なるbool値を保持できます。   | 対応       | 非対応    |

**注**: ネストされた変数に対するハイライト対応は、使用しているデバッガーや環境によって異なる場合があります。また、拡張機能の設定や、ハイライトの適用方法によっても、対応状況が変わることがあります。階層が深い場合、ハイライトが正しく適用されないことがあるため、ご注意ください。

## 貢献

バグの報告や機能要望、プルリクエストは大歓迎です！GitHubリポジトリでイシューやプルリクエストを作成してください。


## ライセンス

この拡張機能はMITライセンスで公開されています。詳細については、リポジトリ内の[LICENSE](LICENSE)ファイルをご覧ください。


