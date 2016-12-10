var execlib = require('allex'),
  lib = execlib.lib,
  q = lib.q,
  qlib = lib.qlib,
  chai = require('chai'),
  chap = require('chai-as-promised'),
  expect,
  FundDistributionExtension = require('..')(execlib),
  Bank,
  DistributedBank,
  dbank;

'use strict';

chai.use(chap);
expect = chai.expect;

function onBankLib (banklib) {
  Bank = banklib.Bank;

  function DBank (prophash) {
    Bank.call(this, prophash);
    FundDistributionExtension.call(this, prophash);
  }
  lib.inherit(DBank, Bank);
  FundDistributionExtension.addMethods(DBank);
  DBank.prototype.destroy = function () {
    FundDistributionExtension.prototype.destroy.call(this);
    Bank.prototype.destroy.call(this);
  };
  //DistributedBank = DBank;

  function TestBank (prophash) {
    var d = q.defer(), od = prophash.starteddefer;
    d.promise.then(this.initialize.bind(this, od));
    prophash.starteddefer = d;
    DBank.call(this, prophash);
    this.fundstatus = {};
    this.initchecksum = 0;
    this.checksum = 0;
  }
  lib.inherit(TestBank, DBank);
  TestBank.prototype.destroy = function () {
    this.checksum = null;
    this.initchecksum = null;
    this.fundstatus = null;
    DBank.prototype.destroy.call(this);
  };
  TestBank.prototype.distribute = function (amount, referencearry) {
    return DBank.prototype.distribute.call(this, amount, referencearry).then(
      this.onDistributeDone.bind(this)
    );
  };
  TestBank.prototype.initialize = function (originalstarteddefer) {
    var t = this, sum = 0, fs = this.fundstatus, p;
    p = this.kvstorage.traverse(function(kv) {
      fs[kv.key] = kv.value;
      sum += kv.value;
      console.log(fs);
    });
    p.then(function() {
      t.initchecksum = sum;
      if (originalstarteddefer) {
        originalstarteddefer.resolve(t);
      }
      //console.log('initial fundstatus', t.fundstatus);
      t = null;
      fs = null;
      sum = null;
    })
  };
  TestBank.prototype.onDistributeDone = function (fundstatus) {
    this.fundstatus = lib.extend(this.fundstatus, fundstatus);
    console.log('now fundstatus', fundstatus);
    return q(fundstatus);
  };
  TestBank.prototype.estimateDistribution = function (amount) {
    return this.calculateDistribution(amount).then(
      this.onCalculationForEstimate.bind(this)
    );
  };
  TestBank.prototype.onCalculationForEstimate = function (dist) {
    var fs = this.fundstatus, estobj;
    estobj = dist.reduce(function (res, distdesc) {
      var dn = distdesc.name, dc = distdesc.charge, val;
      if (dc) {
        val = (fs[dn]||0)-distdesc.charge;
        res.fs[dn] = val;
      } else {
        val = fs[dn]||0;
      }
      res.sum += val;
      //console.log('distdesc', distdesc, fs, '=>', res);
      return res;
    }, {sum:0, fs:{}});
    //console.log('my fundstatus', this.fundstatus, '+', dist, '=>', est);
    fs = null;
    this.checksum = estobj.sum;
    return q(estobj.fs);
  };
  TestBank.prototype.onAccumulationForEstimate = function (amount, accamount) {
    //console.log('onAccumulationForEstimate', amount, accamount, amount+accamount, this.distributeAmount(amount+accamount));
    return q(this.chargedFundStatus(this.distributeAmount(amount+accamount)));
  };
  TestBank.prototype.chargedFundStatus = function (deltaobj) {
    var ret = {}, _r = ret;
    if (!this.fundstatus) {
      return ret;
    }
    lib.traverseShallow(this.fundstatus, function (fund, fundname) {
      _r[fundname] = fund-deltaobj[fundname];
    });
    console.log('chargedFundStatus from', deltaobj, 'with my fundstatus', this.fundstatus, '=>', ret);
    deltaobj = null;
    _r = null;
    return ret;
  };
  TestBank.prototype.estimateAndDistribute = function (amount, referencearry) {
    return this.estimateDistribution(amount).then(
      this.distributeAndExpect.bind(this, amount, referencearry)
    );
  };
  TestBank.prototype.distributeAndExpect = function (amount, referencearry, expected) {
    //return expect(this.distribute(amount, referencearry)).to.eventually.deep.equal(expected);
    return this.distribute(amount, referencearry).then(
      this.compare.bind(this, expected)
    );
  };
  TestBank.prototype.compare = function (expected, obtained) {
    console.log('got', obtained, 'expected', expected);
    try {
      expect(expected).to.deep.equal(obtained);
      return q(true);
    } catch(e) {
      return q.reject(e);
    }
  };
  DistributedBank = TestBank;
  return q(TestBank);
}

function instantiate (prophash) {
  return new DistributedBank(prophash);
}

function setinstance (_dbank) {
  dbank = _dbank;
  return q(dbank);
}

function itemprinter (item) {
  console.log(item);
}

describe ('Basic tests', function () {
  it('Load libraries', function () {
    return execlib.loadDependencies('client', ['allex:leveldbbank:lib'], onBankLib);
  });
  /*
  it('Instantiating a DistributedBank without a path should throw', function () {
    expect(instantiate.bind(null, {})).to.throw(/Path must be a string/);
  });
  it('Instantiating a DistributedBank without funds should throw', function () {
    expect(instantiate.bind(null, {path: 'dbank.db'})).to.throw(/Fund distribution.*is not defined/);
  });
  it('Instantiate a DistributedBank without funddistribution should throw', function () {
    expect(instantiate.bind(null, {path: 'dbank.db', funddistribution: {}})).to.throw(/Distribution.*has to be an object/);
  });
  */
  it('Instantiate a DistributedBank', function () {
    this.timeout(12340000);
    var d = q.defer();
    d.promise.then(setinstance);
    new DistributedBank({
      starteddefer: d,
      path: 'dbank.db',
      funddistribution: {
        percentagedecimals: 0,
        funds: {
          'jp1': 32,
          'jp2': 44,
          'jp3': 16,
          'jp4': 8
        }
      }
    });
    return d.promise;
  });
  it('distribution math', function () {
    var ret = dbank.distributeAmount(20);
    return expect(ret).to.deep.equal([
      {name: 'jp1', charge: -6},
      {name: 'jp2', charge: -8},
      {name: 'jp3', charge: -3},
      {name: 'jp4', charge: -1},
      {name: 'accumulation', charge: -2}
    ]);
  });
  it('initial distribute', function () {
    return dbank.distribute(0, ['initial distribute']);
  });
  it('distribute 20', function () {
    return dbank.estimateAndDistribute(20, 'distribute');
  });
  it('distribute 3', function () {
    return dbank.estimateAndDistribute(3, 'distribute');
  });
  it('distribute 1', function () {
    return dbank.estimateAndDistribute(1, 'distribute');
  });
  it('distribute 120', function () {
    return dbank.estimateAndDistribute(120, 'distribute');
  });
  it('distribute 10000000000', function () {
    return dbank.estimateAndDistribute(10000000000, 'distribute');
  });
  it('checksum', function () {
    console.log(dbank.initchecksum, dbank.checksum);
    //expect(dbank.checksum-dbank.initchecksum).to.equal(144);
    expect(dbank.checksum-dbank.initchecksum).to.equal(10000000144);
  });
  /*
  it('distribute 20', function () {
    var ret = dbank.distribute(20, ['distribute']);
    return expect(ret).to.eventually.deep.equal(
      dbank.chargedFundStatus({
        jp1: 6,
        jp2: 8,
        jp3: 3,
        jp4: 1,
        accumulation: 2
      })
    );
  });
  it('distribute 30', function () {
    var ret = dbank.distribute(30, ['distribute']);
    return expect(ret).to.eventually.deep.equal(
      dbank.chargedFundStatus({
        jp1: 9,
        jp2: 13,
        jp3: 4,
        jp4: 2,
        accumulation: 2
      })
    );
  });
  */
  it('accounts', function () {
    return dbank.kvstorage.traverse(itemprinter, {});
  });
});
