import revHash from'rev-hash';
import revPath from'rev-path';
import path from'path';
import fs from'fs-extra';
import glob from'glob';
import commondir from'commondir';
import assert from 'assert';

export default function(options) {

  const manifest = {};
  //use assert to require filesPath, outputDir
  assert(options.files, 'files property is required');
  const filesPath = options.files;
  const baseStr = options.baseStr || '';
  const outputDir = options.outputDir || __dirname;
  const outputDest = path.resolve(outputDir);
  const file = options.file;
  const hash = options.hash || false;

  function writeManifest(manifest) {
    if (file) {
      fs.ensureFileSync(path.resolve(file));
      fs.writeFileSync(path.resolve(file), JSON.stringify(manifest), 'utf8');
    } else {
      fs.writeFileSync(path.join(__dirname, 'assets.json'), JSON.stringify(manifest), 'utf8');
    }
  }

  const filesPathParts = filesPath.split(',');
  let files = [];
  filesPathParts.forEach(function(filePathPart) {
    files = files.concat(files, glob.sync(path.resolve(filePathPart), {}));
  });
  // Uniquify files
  files = Array.from(new Set(files));

  let baseDir;
  if (files && files.length === 1) {
    baseDir = files[0].split(path.sep).slice(0,-1).join(path.sep);
  } else {
    baseDir = commondir(files);
  }
  if (files && files.length) {
    files.forEach(function(file) {
      const parsedPath = path.parse(file);
      const filename = parsedPath.base;
      const dirParts = parsedPath.dir.split('/');
      let fileDirParts = [];
      while(dirParts.join('/') !== baseDir) {
        fileDirParts.unshift(dirParts.pop());
      }
      fileDirParts.unshift(dirParts.pop());
      fileDirParts = fileDirParts.filter( ( el ) => !baseStr.split('/').includes( el ) );
      let fileDir = fileDirParts.join('/');
      const buffer = fs.readFileSync(file);
      if (hash) {
        const h = revHash(buffer);
        const revdPath = revPath(path.join(fileDir, filename), h);
        manifest[path.join(fileDir, filename)] = revdPath;
        fs.ensureFileSync(path.join(outputDest, revdPath));
        fs.copyFileSync(file, path.join(outputDest, revdPath));
      } else {
        manifest[path.join(fileDir, filename)] = path.join(fileDir, filename);
        fs.ensureFileSync(path.join(outputDest, path.join(fileDir, filename)));
        fs.copyFileSync(file, path.join(outputDest, fileDir, filename));
      }
    });

    const dependencyMap = {};
    if (hash) {
      Object.keys(manifest).forEach(f => {
        if (f.match(/\.(css|js|html)$/i)) {
          const content = fs.readFileSync(path.resolve(path.join(outputDest, manifest[f]))).toString();
          Object.keys(manifest).forEach(k => {
            if (content.match(k)) {
              dependencyMap[f] = dependencyMap[f] || {};
              dependencyMap[f][k] = true;
            }
          });
        }
      });
    }

    const timesInRecursion = {};
    function replaceStringsFor(target) {
      // Check if target is a dependent
      if (dependencyMap[target]) {
        for (var dependency in dependencyMap[target]) {
          if (dependency.match(/\.(css|js|html)$/i)) {
            // Target to be recalculated
            if (typeof timesInRecursion[dependency + "==" + target] === "undefined") {
              timesInRecursion[dependency + "==" + target] = 0;
            }
            // Check if dependecy loop
            if (timesInRecursion[dependency + "==" + target] < 100) {
              timesInRecursion[dependency + "==" + target] = parseInt(timesInRecursion[dependency + "==" + target]) + 1;
              replaceStringsFor(dependency);
            } else {
              console.log("Too deep recursion in dependencies for: [ " + dependency + " ] included in: [ " + target + " ]");
              delete(dependencyMap[target][dependency]);
            }
          }
        }
      }
      // // First find the file in the array
      const manifestFiles = Object.keys(manifest).sort((a, b) => b.length - a.length );
      for(let f of manifestFiles) {
        // File ref found!
        if (f === target) {
          let contents = fs.readFileSync(path.resolve(path.join(outputDest, manifest[f]))).toString();
          for (let depToReplace in dependencyMap[f]) {
            contents = contents.replace(new RegExp(depToReplace, 'g'), manifest[depToReplace]);
          }
          const h = revHash(Buffer.from(contents));
          const newPath = revPath(f, h);

          fs.writeFileSync(path.resolve(path.join(outputDest, newPath)), contents);
          manifest[f] = newPath;
          break;
        }
      }
    };

    // Fix recursive hashes
    if (hash) {
      for (let dependent in dependencyMap) {
        replaceStringsFor(dependent);
      }
    }

    writeManifest(manifest);
  } else {
    console.warn(`No files found matching ${path.resolve(filesPath)}`);
    writeManifest({});
  }
}
