const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const serverPath = path.join(rootDir, 'server.js');
const gitignorePath = path.join(rootDir, '.gitignore');
const testsDir = path.join(__dirname, 'tests');

// 1. Fix server.js
try {
    let content = fs.readFileSync(serverPath, 'utf8');
    const oldStr = "if (secret !== process.env.ADMIN_SECRET && secret !== 'admin123') {";
    const newStr = "if (secret !== process.env.ADMIN_SECRET) {";
    if (content.includes(oldStr)) {
        content = content.replace(oldStr, newStr);
        fs.writeFileSync(serverPath, content);
        console.log('Fixed server.js');
    } else {
        console.log('server.js already fixed or pattern not found');
    }
} catch (e) {
    console.error('Failed to fix server.js:', e.message);
}

// 2. Fix test files
const testFiles = ['regression_faceswap_image.js', 'regression_faceswap_video.js'];
testFiles.forEach(file => {
    try {
        const filePath = path.join(testsDir, file);
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf8');
            const pattern = " || 'cmilqkb360001ib04ita6qnhj'";
            if (content.includes(pattern)) {
                content = content.replace(pattern, '');
                fs.writeFileSync(filePath, content);
                console.log(`Fixed ${file}`);
            } else {
                console.log(`${file} already fixed`);
            }
        } else {
            console.log(`File not found: ${file}`);
        }
    } catch (e) {
        console.error(`Failed to fix ${file}:`, e.message);
    }
});

// 3. Create .gitignore
try {
    const gitignoreContent = "*.env\ndata.json\nnode_modules/\nuploads/\noutputs/\n";
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, gitignoreContent);
        console.log('Created .gitignore');
    } else {
        const current = fs.readFileSync(gitignorePath, 'utf8');
        if (!current.includes('data.json')) {
            fs.appendFileSync(gitignorePath, '\n' + gitignoreContent);
            console.log('Updated .gitignore');
        } else {
            console.log('.gitignore already exists and contains rules');
        }
    }
} catch (e) {
    console.error('Failed to update .gitignore:', e.message);
}
