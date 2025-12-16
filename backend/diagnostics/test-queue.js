const { default: PQueue } = require('p-queue');
console.log('PQueue type:', typeof PQueue);
try {
  const q = new PQueue({ concurrency: 1 });
  console.log('Queue created successfully');
} catch (e) {
  console.error('Error creating queue:', e.message);
  
  // Try alternative import
  try {
      const PQueueAlt = require('p-queue');
      console.log('Alternative import type:', typeof PQueueAlt);
      const q2 = new PQueueAlt({ concurrency: 1 });
      console.log('Alternative Queue created successfully');
  } catch (e2) {
      console.error('Alternative Error:', e2.message);
  }
}
