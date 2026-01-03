import { performance } from 'perf_hooks';
import * as vscode from 'vscode';
import { DebugProtocol } from "@vscode/debugprotocol";

let updateInProgress = false;
let closeSession = false;
let isDebugStopped = false;
let updateIntervalTimer: NodeJS.Timeout | undefined;
let cachedBoolVariables: { [key: string]: boolean } = {};

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

// 設定されたネスト深さの最大値を取得する関数
function getConfiguredMaxDepth(): number {
	const config = vscode.workspace.getConfiguration('boolhighlighter');
	return config.get<number>('maxDepth') || 6;
}

// デバッグモードの設定を取得する関数
function getConfiguredDebugMode(): boolean {
	const config = vscode.workspace.getConfiguration('boolhighlighter');
	return config.get<boolean>('debugMode') || false;
}

// デコレーションタイプの変数宣言
let trueDecorationType: vscode.TextEditorDecorationType;
let falseDecorationType: vscode.TextEditorDecorationType;

// 設定から色を読み込み、デコレーションタイプを作成する関数
function createDecorationTypes() {
	// 既存のデコレーションタイプを破棄してメモリリークを防ぐ
	if (trueDecorationType) {
		trueDecorationType.dispose();
	}
	if (falseDecorationType) {
		falseDecorationType.dispose();
	}

	const config = vscode.workspace.getConfiguration('boolhighlighter');

	const trueColor = config.get<string>('trueBackgroundColor') || 'yellow';
	const falseColor = config.get<string>('falseBackgroundColor') || 'blue';
	const trueTextColor = config.get<string>('trueTextColor') || 'black';
	const falseTextColor = config.get<string>('falseTextColor') || 'white';

	// 真の値のデコレーションタイプを作成
	trueDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: trueColor,
		color: trueTextColor
	});

	// 偽の値のデコレーションタイプを作成
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
				console.log('[BoolHighlighter] Debug session activated');
				updateInProgress = false;
				closeSession = false;
				isDebugStopped = true; // デバッグ開始時は停止中として扱う
				// キャッシュをクリア
				cachedBoolVariables = {};

				// デバッグ開始後にハイライトを更新するための遅延
				setTimeout(() => {
					const startTime = performance.now();
					updateHighlights(); // ハイライトを更新する関数を呼び出し
					const endTime = performance.now();
					// 処理にかかった実行時間をコンソールに出力
					console.log("Activate Time : " + (endTime - startTime));
				}, updateDelay); // 必要に応じて遅延時間を調整

				// ポーリングを開始
				startPolling();
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
					// const startTime = performance.now();
					updateHighlights(); // ハイライトを更新する関数を呼び出し
					// const endTime = performance.now();
					// // 処理にかかった実行時間をコンソールに出力
					// console.log("Step run1 Time : " + (endTime - startTime));
				}, updateDelay); // 必要に応じて遅延時間を調整
			}
		})
	);

	// ステップ実行が完了したとき(stopped)の処理
	context.subscriptions.push(
		vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
			console.log('[BoolHighlighter] Debug event received: ' + event.event);
			// 対象がPythonファイルではない場合何もしない
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId !== "python") {
				return;
			}
			if (event.event === 'stopped') {
				if (vscode.debug.activeDebugSession) {
					console.log('[BoolHighlighter] Debug stopped event received, updating highlights');
					isDebugStopped = true;

					// ステップ実行後にハイライトを更新するための遅延
					setTimeout(() => {
						updateHighlights(); // ハイライトを更新する関数を呼び出し
					}, updateDelay); // 必要に応じて遅延時間を調整

					// 停止中のポーリングを開始
					startPolling();
				}
			} else if (event.event === 'continued') {
				// 実行再開時はポーリングを停止
				console.log('[BoolHighlighter] Debug continued event received, stopping polling');
				isDebugStopped = false;
				stopPolling();
			}
		})
	);


	// デバッグセッションが終了したときの処理
	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession((session) => {
			console.log('[BoolHighlighter] Debug session terminated');
			// セッション終了フラグを先に設定して、進行中の処理をキャンセル
			closeSession = true;
			isDebugStopped = false;
			stopPolling();

			if (vscode.window.activeTextEditor) {
				updateInProgress = false;
				// キャッシュをクリア
				cachedBoolVariables = {};
				clearHighlights(vscode.window.activeTextEditor);
			}
		})
	);
}

// 停止中のポーリングを開始する関数
function startPolling() {
	// 既存のタイマーがあればクリア
	stopPolling();

	const updateInterval = getConfiguredUpdateInterval();
	console.log('[BoolHighlighter] Starting polling with interval=' + updateInterval + 'ms');

	updateIntervalTimer = setInterval(() => {
		// 対象がPythonファイルではない場合何もしない
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.document.languageId !== "python") {
			return;
		}
		if (isDebugStopped && vscode.debug.activeDebugSession) {
			updateHighlights();
		}
	}, updateInterval);
}

// ポーリングを停止する関数
function stopPolling() {
	if (updateIntervalTimer) {
		console.log('[BoolHighlighter] Stopping polling');
		clearInterval(updateIntervalTimer);
		updateIntervalTimer = undefined;
	}
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
		} catch (err: any) {
			// セッション終了時のCanceledエラーは想定内なのでログに出力しない
			if (err?.name !== 'Canceled' && err?.message !== 'Canceled') {
				console.error('スレッド取得中にエラーが発生:', err);
			}
		}

		retryCount++;
		await new Promise((resolve) => setTimeout(resolve, retryInterval));
	}

	throw new Error('利用可能なスレッドが見つかりません');
}

// ハイライトを更新する関数
async function updateHighlights(retryCount = 0) {
	if (closeSession) {
		console.log('[BoolHighlighter] updateHighlights: closeSession is true, skipping');
		return;
	}
	if (updateInProgress) {
		console.log('[BoolHighlighter] updateHighlights: updateInProgress is true, skipping');
		return;
	}
	updateInProgress = true;
	console.log('[BoolHighlighter] updateHighlights: starting (retryCount=' + retryCount + ')');

	try {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			console.log('[BoolHighlighter] updateHighlights: no active editor');
			return;
		}

		if (!vscode.debug.activeDebugSession) {
			console.log('[BoolHighlighter] updateHighlights: no active debug session, clearing highlights');
			clearHighlights(editor);
			return;
		}

		console.log('[BoolHighlighter] updateHighlights: getting available thread');
		// 最初の利用可能なスレッドを取得
		const firstThread = await getAvailableThread(vscode.debug.activeDebugSession);
		console.log('[BoolHighlighter] updateHighlights: thread obtained, id=' + firstThread.id);

		// トップのスタックフレームを取得
		const stackTrace = await vscode.debug.activeDebugSession.customRequest('stackTrace', { threadId: firstThread.id });
		console.log('[BoolHighlighter] updateHighlights: stackFrames count=' + stackTrace.stackFrames.length);

		if (!stackTrace.stackFrames || stackTrace.stackFrames.length === 0) {
			console.log('[BoolHighlighter] updateHighlights: no stack frames available');
			return;
		}

		const topFrameId = stackTrace.stackFrames[0].id;
		console.log('[BoolHighlighter] updateHighlights: stack frame obtained, id=' + topFrameId);

		// トップのスタックフレーム内の変数を取得
		const scopes = await vscode.debug.activeDebugSession.customRequest('scopes', { frameId: topFrameId });
		const localScope = scopes.scopes.find((scope: any) => scope.name === 'Locals');
		console.log('[BoolHighlighter] updateHighlights: local scope found=' + (localScope ? 'yes' : 'no'));

		if (localScope) {
			const localVariables = await getBoolVariables(vscode.debug.activeDebugSession, localScope, topFrameId);
			const count = Object.keys(localVariables).length;
			console.log('[BoolHighlighter] updateHighlights: bool variables count=' + count);

			// 変数が十分に取得できた場合はキャッシュを更新
			// 取得数が少ない場合はDAPの状態によって情報が不完全な可能性があるため、キャッシュを使用
			let boolVariables = localVariables;
			if (count > 0) {
				// 新しい変数情報でキャッシュを更新
				console.log('[BoolHighlighter] updateHighlights: updating cache with ' + count + ' variables');
				cachedBoolVariables = { ...cachedBoolVariables, ...localVariables };
			} else if (Object.keys(cachedBoolVariables).length > 0) {
				// キャッシュが存在する場合はキャッシュを使用
				console.log('[BoolHighlighter] updateHighlights: using cached variables (' + Object.keys(cachedBoolVariables).length + ' variables)');
				boolVariables = cachedBoolVariables;
			}

			applyHighlights(boolVariables, editor);
			console.log('[BoolHighlighter] updateHighlights: highlights applied successfully');
		}
	} catch (err) {
		// デバッグモードに関係なく常にエラーログを出力
		console.error('[BoolHighlighter] ハイライト更新中にエラーが発生:', err);
		const debugMode = getConfiguredDebugMode();
		if (debugMode) {
			vscode.window.showWarningMessage(`Bool Highlighter: ${err}`);
		}
		if ((!closeSession) && (retryCount < 3)) {
			setTimeout(() => updateHighlights(retryCount + 1), 500);
		}
	} finally {
		// 必ずフラグをリセットする
		updateInProgress = false;
	}
}

// ブール変数を抽出する関数
async function getBoolVariables(session: vscode.DebugSession, localScope: any, frameId: number): Promise<{ [key: string]: boolean }> {
	const boolVars: { [key: string]: boolean } = {};

	const maxDepth = getConfiguredMaxDepth();
	console.log('[BoolHighlighter] getBoolVariables: getting nested variables, maxDepth=' + maxDepth + ', variablesReference=' + localScope.variablesReference);
	const variables = await getNestedVariables(session, localScope.variablesReference, maxDepth);
	console.log('[BoolHighlighter] getBoolVariables: total variables retrieved=' + variables.length);

	// ブール型の変数を見つける
	let boolCount = 0;
	for (const variable of variables) {
		if (variable.type === "bool") {
			boolCount++;
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
	console.log('[BoolHighlighter] getBoolVariables: bool variables found=' + boolCount);

	// 変数が少ない場合、キャッシュから変数名を取得して個別に評価
	if (boolCount === 0 && Object.keys(cachedBoolVariables).length > 0) {
		console.log('[BoolHighlighter] getBoolVariables: no variables found, refreshing ' + Object.keys(cachedBoolVariables).length + ' cached variables');
		for (const varName of Object.keys(cachedBoolVariables)) {
			try {
				const result = await session.customRequest('evaluate', {
					expression: varName,
					frameId: frameId,
					context: 'watch'
				});
				if (result.type === 'bool') {
					boolVars[varName] = result.result === 'True';
				}
			} catch (err) {
				// 変数が存在しない場合はスキップ（ログなし）
			}
		}
		console.log('[BoolHighlighter] getBoolVariables: refreshed ' + Object.keys(boolVars).length + ' variables from cache');
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

	// start/countパラメータなしで一度だけリクエスト
	// Python Debug Adapterはページングに対応していないことが判明したため、
	// シンプルに一度だけリクエストする方が高速
	const response = await session.customRequest("variables", { variablesReference });
	const variables: DebugProtocol.Variable[] = response.variables || [];

	// 取得した変数をフィルタリングして処理
	const processedVariables: DebugProtocol.Variable[] = [];

	for (const variable of variables) {
		// 特定の型の変数をスキップ
		if (variable.type === 'NoneType' || variable.type === 'int' || variable.type === 'str' || variable.type === 'float' || variable.type === 'module') {
			continue;
		}
		if (variable.type === '' && variable.name !== 'class variables') {
			continue;
		}
		processedVariables.push(variable);

		// 変数がネストされている場合、再帰的に取得
		if (variable.variablesReference > 0) {
			const nestedVariables = await getNestedVariables(
				session,
				variable.variablesReference,
				maxDepth,
				currentDepth + 1,
				seenReferences
			);
			processedVariables.push(...nestedVariables);
		}

		// クラス変数を検出する
		if (variable.name === 'class variables') {
			// __class__からクラス名を取得
			const classVariablesResponse = await session.customRequest('variables', { variablesReference: variable.variablesReference });
			const classNameVariable = classVariablesResponse.variables.find((v: any) => v.name === '__class__');
			let className = '';

			if (classNameVariable) {
				// __class__の値からクラス名を抽出（例: "<class '__main__.MyClass'>" -> "MyClass"）
				const match = classNameVariable.value.match(/'([^']*\.)?([^'.]*)'/);
				className = match ? match[2] : '';
			}

			const classVariables = await getNestedVariables(
				session,
				variable.variablesReference,
				maxDepth,
				currentDepth,
				seenReferences
			);

			// すべてのbool変数にクラス名を付与
			for (let i = 0; i < classVariables.length; i++) {
				if (classVariables[i].type === 'bool' && className) {
					classVariables[i].evaluateName = className + '.' + classVariables[i].name;
				}
			}
			processedVariables.push(...classVariables);
		}
	}

	return processedVariables;
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
			// 変数の値に応じて、ハイライト範囲を追加する
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

function deactivate() {
	// リソースを解放してメモリリークを防ぐ
	if (trueDecorationType) {
		trueDecorationType.dispose();
	}
	if (falseDecorationType) {
		falseDecorationType.dispose();
	}
}

module.exports = {
	activate,
	deactivate
};

