function inject(file, tag) {
	const node = document.getElementsByTagName(tag)[0];
	const script = document.createElement('script');
	script.setAttribute('type', 'module');
	script.setAttribute('src', file);
	node.appendChild(script);
}
inject(chrome.runtime.getURL('scripts/vineyard.js'), 'body');
