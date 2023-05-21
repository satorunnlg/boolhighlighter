import { Session } from 'inspector';
import { performance } from 'perf_hooks';
import * as vscode from 'vscode';
import { DebugProtocol } from "vscode-debugprotocol";

let updateInProgress = false;
let closeSession = false;

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

// 指定されたフレームIDを持つデバッグセッションのスコープを取得する非同期関数
async function getScope(session: vscode.DebugSession, frameId: number): Promise<any | undefined> {
	const scopesResponse = await session.customRequest('scopes', { frameId });
	if (scopesResponse && scopesResponse.scopes && scopesResponse.scopes.length > 0) {
		return scopesResponse.scopes[0]; // 最初のスコープを返す
	}
	return undefined;
}

// クラス内の指定された変数名を持つ変数を検索する非同期関数
// session: デバッグセッション
// variablesReference: 変数の参照番号
// variableName: 検索する変数名
async function findVariableInClass(session: vscode.DebugSession, variablesReference: number, variableName: string): Promise<any | undefined> {
	// クラスの変数を取得
	const classVariablesResponse = await session.customRequest('variables', { variablesReference });
	// 指定された変数名を持つ変数を検索
	const classVariable = await findVariableByName(classVariablesResponse.variables, variableName);

	// 変数が見つかった場合、その変数を返す
	if (classVariable) {
		return classVariable;
	}

	// 親クラスの変数を取得
	const superClassVariable = await findVariableByName(classVariablesResponse.variables, '__class__');

	// 親クラスが存在する場合、再帰的に親クラスの変数を検索
	if (superClassVariable) {
		return await findVariableInClass(session, superClassVariable.variablesReference, variableName);
	}

	// 変数が見つからない場合、undefinedを返す
	return undefined;
}

// 指定されたスコープと変数名を持つデバッグセッションの変数を取得する非同期関数
// session: デバッグセッション
// scope: 検索対象のスコープ
// variableName: 検索する変数名
async function getVariable(session: vscode.DebugSession, scope: any, variableName: string): Promise<any | undefined> {
	// 変数名を"."や"["、"]"で分割し、空でない名前の配列を作成
	const variableNames = variableName.split(/[\.\[\]]/).filter(name => name.length > 0);

	// トップレベルの変数を取得
	const topLevelVariableResponse = await session.customRequest('variables', { variablesReference: scope.variablesReference });
	// 最初の変数名に一致する変数を検索
	let currentVariable = await findVariableByName(topLevelVariableResponse.variables, variableNames[0]);

	// 変数が見つからない場合、クラス変数を検索
	if (!currentVariable) {
		const selfVariable = await findVariableByName(topLevelVariableResponse.variables, 'class variables');
		if (selfVariable) {
			// クラス変数内で最初の変数名に一致する変数を検索
			currentVariable = await findVariableInClass(session, selfVariable.variablesReference, variableNames[0]);
			if (!currentVariable) {
				throw new Error(`Failed to retrieve variable: ${variableNames[0]}`);
			}
		} else {
			throw new Error(`Failed to retrieve variable: ${variableNames[0]}`);
		}
	}

	// 残りの変数名について、ネストされた変数を検索
	for (let i = 1; i < variableNames.length && currentVariable; i++) {
		const childVariablesResponse = await session.customRequest('variables', { variablesReference: currentVariable.variablesReference });
		currentVariable = await findVariableByName(childVariablesResponse.variables, variableNames[i]);

		// クラス変数内で一致する変数を検索
		if (!currentVariable) {
			currentVariable = await findVariableInClass(session, childVariablesResponse.variablesReference, variableNames[i]);
			if (!currentVariable) {
				throw new Error(`Failed to retrieve variable: ${variableNames[i]}`);
			}
		}
	}

	// 最終的に見つかった変数を返す
	return currentVariable;
}

// 与えられた名前と一致する変数を変数のリストから検索する非同期関数
async function findVariableByName(variables: any[], name: string): Promise<any | undefined> {
	for (const variable of variables) {
		if (variable.name === name || variable.evaluateName === name) {
			return variable;
		}
	}
	return undefined;
}

// デバッグセッションの最初のスレッドの最初のフレームIDを取得する非同期関数
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

// アクティブなエディタで選択されている変数名を取得する関数
function getSelectedVariableName(): string | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return undefined;
	}

	// アクティブなエディタの選択されたテキストを取得
	const selectedText = editor.document.getText(editor.selection);
	return selectedText;
}

// デバッグセッション内の指定された変数の値をトグルする非同期関数
async function toggleValueInDebugSession(session: vscode.DebugSession, frameId: number, variableName: string): Promise<void> {
	const scope = await getScope(session, frameId);
	if (!scope) {
		throw new Error('Failed to get scope.');
	}

	try {
		const variable = await getVariable(session, scope, variableName);
		// 値を変更するロジックを実装
		const newValue = variable.value === 'True' ? 'False' : 'True';
		let expression = `${variableName} = ${newValue}`;
		await session.customRequest('evaluate', { expression, frameId, context: 'repl' });
	} catch (error) {
		vscode.window.showErrorMessage(String(error)); // エラーメッセージを表示
	}
}

// 拡張機能が有効化された際の処理
export function activate(context: vscode.ExtensionContext) {
	// デコレーションタイプを作成
	createDecorationTypes();

	const updateDelay = getConfiguredUpdateDelay();
	const updateInterval = getConfiguredUpdateInterval();

	// 新しいコマンドを登録（ブール値をトグルする機能）
	const toggleBooleanValue = vscode.commands.registerCommand('boolHighlighter.toggleBooleanValue', async () => {
		// 対象がPythonファイルではない場合何もしない
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId !== "python") {
			return;
		}
		// アクティブなデバッグセッションが存在しない場合、エラーメッセージを表示して処理を終了
		if (!vscode.debug.activeDebugSession) {
			vscode.window.showErrorMessage('No active debug session found.');
			return;
		}

		// アクティブなデバッグセッションからフレームIDを取得
		const frameId = await getFrameId(vscode.debug.activeDebugSession);
		// エディタ上で選択された変数名を取得
		const variableName = getSelectedVariableName();

		// フレームIDと変数名が取得できた場合のみ処理を続行
		if (frameId && variableName) {
			// 最初のスコープを取得
			const scope = await getScope(vscode.debug.activeDebugSession, frameId);
			if (!scope) {
				vscode.window.showErrorMessage('Failed to retrieve scope.');
				return;
			}

			// 指定された変数名に対応する変数を取得
			const variable = await getVariable(vscode.debug.activeDebugSession, scope, variableName);
			if (!variable) {
				vscode.window.showErrorMessage('Failed to retrieve variable.');
				return;
			}

			try {
				// ブール値をトグルする関数を呼び出し
				await toggleValueInDebugSession(vscode.debug.activeDebugSession, frameId, variableName);
				// ブール値をトグル後にハイライトを更新するための遅延
				setTimeout(() => {
					const startTime = performance.now();
					updateHighlights(); // ハイライトを更新する関数を呼び出し
					const endTime = performance.now();
					// 処理にかかった実行時間をコンソールに出力
					console.log("Toggle Time : " + (endTime - startTime));
				}, updateDelay); // 必要に応じて遅延時間を調整
			} catch (error) {
				// トグル処理でエラーが発生した場合、エラーメッセージを表示
				vscode.window.showErrorMessage('Failed to toggle boolean value: ' + String(error));
			}
		} else {
			// フレームIDまたは変数名が取得できなかった場合、エラーメッセージを表示
			vscode.window.showErrorMessage('Failed to retrieve frameId or variable name.');
		}
	});
	context.subscriptions.push(toggleBooleanValue);

	// デバッグセッションがアクティブになったときの処理
	context.subscriptions.push(
		vscode.debug.onDidChangeActiveDebugSession(async () => {
			// 対象がPythonファイルではない場合何もしない
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId !== "python") {
				return;
			}
			if (vscode.debug.activeDebugSession) {
				updateInProgress = false;
				closeSession = false;
				// デバッグ開始後にハイライトを更新するための遅延
				setTimeout(() => {
					const startTime = performance.now();
					updateHighlights(); // ハイライトを更新する関数を呼び出し
					const endTime = performance.now();
					// 処理にかかった実行時間をコンソールに出力
					console.log("Activate Time : " + (endTime - startTime));
				}, updateDelay); // 必要に応じて遅延時間を調整
			}
		})
	);

	// アクティブなテキストエディタが変更されたときの処理
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			// 対象がPythonファイルではない場合何もしない
			if (editor && editor.document.languageId !== "python") {
				return;
			}
			if (vscode.debug.activeDebugSession) {
				// アクティブなエディタが変更された後にハイライトを更新するための遅延
				setTimeout(() => {
					const startTime = performance.now();
					updateHighlights(); // ハイライトを更新する関数を呼び出し
					const endTime = performance.now();
					// 処理にかかった実行時間をコンソールに出力
					console.log("Step run1 Time : " + (endTime - startTime));
				}, updateDelay); // 必要に応じて遅延時間を調整
			}
		})
	);

	// // ステップ実行が完了したときの処理
	// context.subscriptions.push(
	// 	vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
	// 		if (event.event === 'stopped') {
	// 			if (vscode.debug.activeDebugSession) {
	// 				// ステップ実行後にハイライトを更新するための遅延
	// 				setTimeout(() => {
	// 					const startTime = performance.now();
	// 					updateHighlights(); // ハイライトを更新する関数を呼び出し
	// 					const endTime = performance.now();
	// 					// 処理にかかった実行時間をコンソールに出力
	// 					console.log("Step run Time : " + (endTime - startTime));
	// 				}, updateDelay); // 必要に応じて遅延時間を調整
	// 			}
	// 		}
	// 	})
	// );

	// 一定間隔でハイライトを更新する処理
	const updateHighlightsInterval = setInterval(() => {
		// 対象がPythonファイルではない場合何もしない
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId !== "python") {
			return;
		}
		if (vscode.debug.activeDebugSession) {
			updateHighlights();
		}
	}, updateInterval);
	context.subscriptions.push({ dispose: () => clearInterval(updateHighlightsInterval) });


	// デバッグセッションが終了したときの処理
	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession((session) => {
			if (vscode.window.activeTextEditor) {
				updateInProgress = false;
				closeSession = true;
				clearHighlights(vscode.window.activeTextEditor);
			}
		})
	);
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
	if (closeSession) {
		return;
	}
	if (updateInProgress) {
		return;
	}
	updateInProgress = true;

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	if (!vscode.debug.activeDebugSession) {
		clearHighlights(editor);
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
			const localVariables = await getBoolVariables(vscode.debug.activeDebugSession, localScope);
			const boolVariables = localVariables;

			applyHighlights(boolVariables, editor);
		}
	} catch (err) {
		console.error('ハイライト更新中にエラーが発生:', err);
		if ((!closeSession) && (retryCount < 3)) {
			setTimeout(() => updateHighlights(retryCount + 1), 500);
		}
	}

	updateInProgress = false;
}

// ブール変数を抽出する関数
async function getBoolVariables(session: vscode.DebugSession, localScope: any): Promise<{ [key: string]: boolean }> {
	const boolVars: { [key: string]: boolean } = {};

	const variables = await getNestedVariables(session, localScope.variablesReference, 2);

	// ブール型の変数を見つける
	for (const variable of variables) {
		if (variable.type === "bool") {
			if (variable.evaluateName)
			{
				boolVars[variable.evaluateName] = variable.value === "True";
			}
			else
			{
				boolVars[variable.name] = variable.value === "True";
			}
		}
	}

	return boolVars;
}

// デバッグセッションからネストされた変数を取得する非同期関数
async function getNestedVariables(
	session: vscode.DebugSession,
	variablesReference: number,
	maxDepth: number,
	currentDepth: number = 0,
	seenReferences: Set<number> = new Set()
): Promise<DebugProtocol.Variable[]> {
	// 既に処理された参照または最大深度に達した場合、空の配列を返す
	if ((seenReferences.has(variablesReference) && currentDepth !== 0) || currentDepth >= maxDepth) {
		return [];
	}
	seenReferences.add(variablesReference);

	const variables: DebugProtocol.Variable[] = [];
	const response = await session.customRequest("variables", { variablesReference });

	for (const variable of response.variables) {
		// 特定の型の変数をスキップ
		if (variable.type === 'NoneType' || variable.type === 'int' || variable.type === 'str' || variable.type === 'float' || variable.type === 'module') {
			continue;
		}
		if (variable.type === '' && variable.name !== 'class variables') {
			continue;
		}
		variables.push(variable);

		// 変数がネストされている場合、再帰的に取得
		if (variable.variablesReference > 0) {
			const nestedVariables = await getNestedVariables(
				session,
				variable.variablesReference,
				maxDepth,
				currentDepth + 1,
				seenReferences
			);
			variables.push(...nestedVariables);
		}

		// クラス変数を検出する
		if (variable.name === 'class variables') {
			const classVariables = await getNestedVariables(
				session,
				variable.variablesReference,
				maxDepth,
				currentDepth,
				seenReferences
			);
			let className = '';
			for (var i = 0; i < classVariables.length; i++) {
				if (classVariables[i].type !== 'bool')
				{
					className = classVariables[i].name;
				}
				else
				{
					classVariables[i].evaluateName = className + '.' + classVariables[i].name;
				}
			}
			variables.push(...classVariables);
		}
	}

	return variables;
}

// ハイライトを適用する関数
function applyHighlights(variables: { [key: string]: boolean }, editor: vscode.TextEditor) {
	const trueRanges: vscode.Range[] = [];
	const falseRanges: vscode.Range[] = [];
	const text = editor.document.getText();

	// 変数名ごとにハイライトを適用する
	for (const variableName in variables) {
		const variableValue = variables[variableName];

		const escapedVariableName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 特殊文字をエスケープ
		const regex = new RegExp(`(?<![a-zA-Z0-9_$])${escapedVariableName}(?![a-zA-Z0-9_$])`, 'g');

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

