// helper for printing timings

export { tic, toc };

let timingStack: [string, number][] = [];
let i = 0;

function tic(label = `Run command ${i++}`) {
  process.stdout.write(`${label}... `);
  timingStack.push([label, Date.now()]);
}

function toc() {
  let stackItem = timingStack.pop();
  if (stackItem == undefined) {
    return;
  }
  let [label, start] = stackItem;
  let time = (Date.now() - start) / 1000;
  process.stdout.write(`\r${label}... ${time.toFixed(3)} sec\n`);
}
