export async function sleep(duration) {
  return new Promise(function(accept) {
    setTimeout(accept, duration);
    });
}

