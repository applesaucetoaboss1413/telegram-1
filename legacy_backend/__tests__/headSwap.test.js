const { validateHeadImage, validateTargetMedia, startHeadSwapTask } = require('../src/services/headSwapService');
const { callA2eApi } = require('../src/services/a2eClient');

jest.mock('../src/services/a2eClient');
jest.mock('fluent-ffmpeg');
jest.mock('fs');

describe('Head Swap Service', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('startHeadSwapTask calls A2E API correctly', async () => {
        callA2eApi.mockResolvedValue({
            code: 0,
            data: { _id: 'task_123', current_status: 'processing' }
        });

        const result = await startHeadSwapTask('http://head.jpg', 'http://target.jpg', 'task_name');

        expect(callA2eApi).toHaveBeenCalledWith('/userHeadSwapTask/add', 'POST', {
            name: 'task_name',
            face_url: 'http://head.jpg',
            target_url: 'http://target.jpg'
        });
        expect(result).toEqual({ taskId: 'task_123', status: 'processing' });
    });

    test('startHeadSwapTask throws error on API failure', async () => {
        callA2eApi.mockResolvedValue({
            code: 1,
            data: { failed_message: 'Invalid input' }
        });

        await expect(startHeadSwapTask('h', 't', 'n'))
            .rejects.toThrow('Invalid input');
    });

    // Note: Validation tests would require complex mocking of ffmpeg/fs, skipping for now in this brief test suite.
});
