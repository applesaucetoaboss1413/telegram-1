const PQueueImport = require('p-queue');

async function testQueue() {
  console.log('Type of require("p-queue"):', typeof PQueueImport);
  console.log('Keys:', Object.keys(PQueueImport));
  
  const PQueue = PQueueImport.default || PQueueImport;
  
  try {
    const queue = new PQueue({ concurrency: 1 });
    console.log('Queue created successfully with', PQueueImport.default ? '.default' : 'direct import');
  } catch (error) {
    console.error('Error creating queue:', error);
  }
}

testQueue();
