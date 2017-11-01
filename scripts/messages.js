/* globals WebSocket, location, document */
const HOST = location.href.replace(/^http/, 'ws');
console.log(HOST);

const ws = new WebSocket(HOST);
const deployId = document.getElementById('deployId').value;
console.log('deployId is ' + deployId);

ws.onmessage = function (event) {
	if (event.data.deployId === deployId){
		console.log('mine');
		console.log(event.data);
	} else {
		console.log('not mine');
		console.log(event.data);
	}
};