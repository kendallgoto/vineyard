function inject(file, tag) {
	var node = document.getElementsByTagName(tag)[0];
	var script = document.createElement('script');
	script.setAttribute('type', 'module');
	script.setAttribute('src', file);
	node.appendChild(script);
}
inject(chrome.runtime.getURL('scripts/vineyard.js'), 'body');
