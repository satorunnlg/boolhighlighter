import * as vscode from 'vscode';

// 設定された遅延時間を取得する関数
function getConfiguredUpdateDelay(): number {
	const config = vscode.workspace.getConfiguration('boolhighlighter');
	return config.get<number>('updateDelay') || 500;
}

// 設定された更新間隔を取得する関数
function getConfiguredUpdateInterval(): number {
	const config = vscode.workspace.getConfiguration('boolhighlighter');
	return config.get<number>('updateInterval') || 1000;
}

// イエロー背景のデコレーションタイプを作成
let yellowDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'yellow'
});

// ブルー背景のデコレーションタイプを作成
let blueDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'blue'
});

// 設定から色を読み込み、デコレーションタイプを作成する関数
function createDecorationTypes() {
	const config = vscode.workspace.getConfiguration('boolhighlighter');

	const yellowColor = config.get<string>('yellowColor') || 'yellow';
	const blueColor = config.get<string>('blueColor') || 'blue';
	const yellowTextColor = config.get<string>('yellowTextColor') || 'black';
	const blueTextColor = config.get<string>('blueTextColor') || 'white';

	// イエロー背景デコレーションタイプを更新
	yellowDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: yellowColor,
		color: yellowTextColor
	});

	// ブルー背景デコレーションタイプを更新
	blueDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: blueColor,
		color: blueTextColor
	});
}

// 拡張機能が有効化された際の処理
export function activate(context: vscode.ExtensionContext) {
	// デコレーションタイプを作成
	createDecorationTypes();

	const updateDelay = getConfiguredUpdateDelay();
	const updateInterval = getConfiguredUpdateInterval();

	// デバッグセッションがアクティブになったときの処理
	context.subscriptions.push(
		vscode.debug.onDidChangeActiveDebugSession(async () => {
			if (vscode.debug.activeDebugSession) {
				// デバッグ開始後にハイライトを更新するための遅延
				setTimeout(() => {
					updateHighlights();
				}, updateDelay); // 必要に応じて遅延時間を調整
			}
		})
	);

	// デバッグセッションが終了したときの処理
	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession((session) => {
			if (vscode.window.activeTextEditor) {
				clearHighlights(vscode.window.activeTextEditor);
			}
		})
	);

	// 定期的にハイライトを更新するためのインターバル
	const updateIntervalId = setInterval(() => {
		if (vscode.debug.activeDebugSession) {
			// インターバルごとにハイライトを更新するための遅延
			setTimeout(() => {
				updateHighlights();
			}, updateDelay); // 必要に応じて遅延時間を調整
		}
	}, updateInterval);

	// 拡張機能が非アクティブになったときにインターバルをクリアする
	context.subscriptions.push({
		dispose: () => {
			clearInterval(updateIntervalId);
		},
	});
}

// 利用可能なスレッドを取得する関数
async function getAvailableThread(debugSession: vscode.DebugSession): Promise<any> {
	let retryCount = 0;
	let maxRetries = 10;
	let retryInterval = 100; // milliseconds

	while (retryCount < maxRetries) {
		try {
			const threads = await debugSession.customRequest('threads');
			const firstThread = threads.threads[0];

			if (firstThread) {
				return firstThread;
			}
		} catch (err) {
			console.error('スレッド取得中にエラーが発生:', err);
		}

		retryCount++;
		await new Promise((resolve) => setTimeout(resolve, retryInterval));
	}

	throw new Error('利用可能なスレッドが見つかりません');
}

// ハイライトを更新する関数
async function updateHighlights(retryCount = 0) {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !vscode.debug.activeDebugSession) {
		return;
	}

	try {
		// 最初の利用可能なスレッドを取得
		const firstThread = await getAvailableThread(vscode.debug.activeDebugSession);

		// トップのスタックフレームを取得
		const stackTrace = await vscode.debug.activeDebugSession.customRequest('stackTrace', { threadId: firstThread.id });
		const topFrameId = stackTrace.stackFrames[0].id;

		// トップのスタックフレーム内の変数を取得
		const scopes = await vscode.debug.activeDebugSession.customRequest('scopes', { frameId: topFrameId });
		const localScope = scopes.scopes.find((scope: any) => scope.name === 'Locals');

		if (localScope) {
			const localVariablesResponse = await vscode.debug.activeDebugSession.customRequest('variables', { variablesReference: localScope.variablesReference });
			const localVariables = localVariablesResponse.variables;
			const boolVariables = getBoolVariables(localVariables);

			applyHighlights(boolVariables, editor);
		}
	} catch (err) {
		console.error('ハイライト更新中にエラーが発生:', err);
		if (retryCount < 3) {
			setTimeout(() => updateHighlights(retryCount + 1), 500);
		}
	}
}

// ブール変数を抽出する関数
function getBoolVariables(variables: any[]): { [key: string]: boolean } {
	const boolVars: { [key: string]: boolean } = {};

	// ブール型の変数を見つける
	for (const variable of variables) {
		if (variable.type === "bool") {
			boolVars[variable.name] = variable.value === "True
		}
	}
}

return boolVars;
}

// ハイライトを適用する関数
function applyHighlights(variables: { [key: string]: boolean }, editor: vscode.TextEditor) {
	const yellowRanges: vscode.Range[] = [];
	const blueRanges: vscode.Range[] = [];

	// 変数名ごとにハイライトを適用する
	for (const variableName in variables) {
		const variableValue = variables[variableName];

		const regex = new RegExp(`\\b${variableName}\\b`, 'g');
		const text = editor.document.getText();

		let match;
		// テキスト内の変数名が一致する部分を見つける
		while ((match = regex.exec(text)) !== null) {
			const startPos = editor.document.positionAt(match.index);
			const endPos = editor.document.positionAt(match.index + match[0].length);
			const range = new vscode.Range(startPos, endPos);

			// 変数の値に応じてハイライトの色を適用する
			if (variableValue) {
				yellowRanges.push(range);
			} else {
				blueRanges.push(range);
			}
		}
	}

	editor.setDecorations(yellowDecorationType, yellowRanges);
	editor.setDecorations(blueDecorationType, blueRanges);
}

// ハイライトをクリアする関数
function clearHighlights(editor: vscode.TextEditor) {
	editor.setDecorations(yellowDecorationType, []);
	editor.setDecorations(blueDecorationType, []);
}

exports.activate = activate;

function deactivate() { }

module.exports = {
	activate,
	deactivate
};

