import { Session } from 'inspector';
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

// 真の値のデコレーションタイプを作成
let trueDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'yellow'
});

// 偽の値のデコレーションタイプを作成
let falseDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'blue'
});

// 設定から色を読み込み、デコレーションタイプを作成する関数
function createDecorationTypes() {
	const config = vscode.workspace.getConfiguration('boolhighlighter');

	const trueColor = config.get<string>('trueBackgroundColor') || 'yellow';
	const falseColor = config.get<string>('falseBackgroundColor') || 'blue';
	const trueTextColor = config.get<string>('trueTextColor') || 'black';
	const falseTextColor = config.get<string>('falseTextColor') || 'white';

	// 真の値のデコレーションタイプを更新
	trueDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: trueColor,
		color: trueTextColor
	});

	// 偽の値のデコレーションタイプを更新
	falseDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: falseColor,
		color: falseTextColor
	});
}

async function getScope(session: vscode.DebugSession, frameId: number): Promise<any | undefined> {
	const scopesResponse = await session.customRequest('scopes', { frameId });
	if (scopesResponse && scopesResponse.scopes && scopesResponse.scopes.length > 0) {
		return scopesResponse.scopes[0]; // 最初のスコープを返す
	}
	return undefined;
}

async function getVariable(session: vscode.DebugSession, scope: any, variableName: string): Promise<any | undefined> {
	const variablesResponse = await session.customRequest('variables', { variablesReference: scope.variablesReference });
	for (const variable of variablesResponse.variables) {
		if (variable.name === variableName) {
			return variable;
		}
	}
	return undefined;
}

async function getFrameId(session: vscode.DebugSession): Promise<number | undefined> {
	try {
		// threadsリクエストを使用して実行中のスレッドを取得
		const threadsResponse = await session.customRequest('threads');
		const threads = threadsResponse.threads;

		// 最初のスレッドを取得
		const firstThread = threads[0];
		if (!firstThread) {
			return undefined;
		}

		// 最初のスレッドのスタックトレースを取得
		const stackTraceResponse = await session.customRequest('stackTrace', {
			threadId: firstThread.id,
		});
		const stackFrames = stackTraceResponse.stackFrames;

		// スタックフレームの最初のフレームを取得
		const firstFrame = stackFrames[0];
		if (!firstFrame) {
			return undefined;
		}

		// 最初のフレームのIDを返す
		return firstFrame.id;
	} catch (error) {
		console.error('Failed to get frame ID:', error);
		return undefined;
	}
}

function getSelectedVariableName(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	// アクティブなエディタの選択されたテキストを取得
	const selectedText = editor.document.getText(editor.selection);
	return selectedText;
}

async function toggleValueInDebugSession(session: vscode.DebugSession, frameId: number, variableName: string): Promise<void> {
	const scope = await getScope(session, frameId);
	if (!scope) {
		throw new Error('Failed to get scope.');
	}

	const variable = await getVariable(session, scope, variableName);
	if (!variable) {
		throw new Error('Failed to get variable.');
	}

	// 値を変更するロジックを実装
	const newValue = variable.value === 'True' ? 'False' : 'True';
	await session.customRequest('setVariable', { variablesReference: scope.variablesReference, name: variableName, value: newValue });
}

// 拡張機能が有効化された際の処理
export function activate(context: vscode.ExtensionContext) {
	// デコレーションタイプを作成
	createDecorationTypes();

	const updateDelay = getConfiguredUpdateDelay();
	const updateInterval = getConfiguredUpdateInterval();

	// 新しいコマンドを登録
	const toggleBooleanValue = vscode.commands.registerCommand('boolHighlighter.toggleBooleanValue', async () => {
		if (!vscode.debug.activeDebugSession) {
			vscode.window.showErrorMessage('No active debug session found.');
			return;
		}

		const frameId = await getFrameId(vscode.debug.activeDebugSession); // フレームIDを取得
		const variableName = getSelectedVariableName(); // 変数名を取得

		if (frameId && variableName) {
			const scope = await getScope(vscode.debug.activeDebugSession, frameId);
			if (!scope) {
				vscode.window.showErrorMessage('Failed to retrieve scope.');
				return;
			}

			const variable = await getVariable(vscode.debug.activeDebugSession, scope, variableName);
			if (!variable) {
				vscode.window.showErrorMessage('Failed to retrieve variable.');
				return;
			}

			try {
				await toggleValueInDebugSession(vscode.debug.activeDebugSession, frameId, variableName); // ここで variableName を渡す
			} catch (error) {
				vscode.window.showErrorMessage('Failed to toggle boolean value: ' + String(error));
			}
		} else {
			vscode.window.showErrorMessage('Failed to retrieve frameId or variable name.');
		}
	});


	context.subscriptions.push(toggleBooleanValue);

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
			boolVars[variable.name] = variable.value === "True";
		}
	}

	return boolVars;
}

// ハイライトを適用する関数
function applyHighlights(variables: { [key: string]: boolean }, editor: vscode.TextEditor) {
	const trueRanges: vscode.Range[] = [];
	const falseRanges: vscode.Range[] = [];

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
			// て、ハイライト範囲を追加する
			if (variableValue) {
				trueRanges.push(range);
			} else {
				falseRanges.push(range);
			}
		}
	}
	// 真および偽の値のハイライトを適用する
	editor.setDecorations(trueDecorationType, trueRanges);
	editor.setDecorations(falseDecorationType, falseRanges);
}

// ハイライトをクリアする関数
function clearHighlights(editor: vscode.TextEditor) {
	editor.setDecorations(trueDecorationType, []);
	editor.setDecorations(falseDecorationType, []);
}

exports.activate = activate;

function deactivate() { }

module.exports = {
	activate,
	deactivate
};

